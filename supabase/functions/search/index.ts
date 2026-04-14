import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, n_results = 8, doc_id } = await req.json();
    if (!query || typeof query !== "string" || query.length > 500) {
      return new Response(JSON.stringify({ error: "Valid query string required (max 500 chars)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Step 1: Get candidate chunks via text search (broad match with keywords)
    const keywords = query.split(/\s+/).filter((w: string) => w.length > 2);
    const orFilter = keywords.map((k: string) => `content.ilike.%${k}%`).join(",");

    let candidateQuery = supabase
      .from("chunks")
      .select("id, doc_id, chunk_index, content")
      .limit(30);

    if (doc_id) {
      candidateQuery = candidateQuery.eq("doc_id", doc_id);
    }

    if (orFilter) {
      candidateQuery = candidateQuery.or(orFilter);
    }

    const { data: candidates, error: candErr } = await candidateQuery;
    if (candErr) throw new Error(candErr.message);

    if (!candidates || candidates.length === 0) {
      // Fallback: get any chunks if keyword search returns nothing
      const { data: fallback } = await supabase
        .from("chunks")
        .select("id, doc_id, chunk_index, content")
        .limit(20);
      
      if (!fallback || fallback.length === 0) {
        return new Response(
          JSON.stringify({ query, results: [] }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // Use fallback candidates for AI ranking
      return await rankAndRespond(fallback, query, n_results, supabase, LOVABLE_API_KEY, corsHeaders);
    }

    return await rankAndRespond(candidates, query, n_results, supabase, LOVABLE_API_KEY, corsHeaders);
  } catch (e) {
    console.error("search error:", e);

    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg.includes("429")) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded, please try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (msg.includes("402")) {
      return new Response(
        JSON.stringify({ error: "Payment required, please add credits." }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function rankAndRespond(
  candidates: any[],
  query: string,
  nResults: number,
  supabase: any,
  apiKey: string,
  corsHeaders: Record<string, string>
) {
  // Step 2: Use AI to rank chunks by semantic relevance
  const chunkSummaries = candidates.map((c: any, i: number) => 
    `[${i}] ${c.content.slice(0, 300)}`
  ).join("\n\n");

  const rankResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        {
          role: "system",
          content: `You are a semantic search ranker. Given a query and numbered text chunks, return the indices of the most relevant chunks ranked by relevance, with a relevance score 0-1. Return ONLY valid JSON.`,
        },
        {
          role: "user",
          content: `Query: "${query}"\n\nChunks:\n${chunkSummaries}`,
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "rank_results",
            description: "Return ranked search results with relevance scores",
            parameters: {
              type: "object",
              properties: {
                rankings: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      index: { type: "integer", description: "Chunk index from the input" },
                      score: { type: "number", description: "Relevance score 0.0 to 1.0" },
                    },
                    required: ["index", "score"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["rankings"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "rank_results" } },
    }),
  });

  if (!rankResponse.ok) {
    const errText = await rankResponse.text();
    console.error("AI ranking error:", rankResponse.status, errText);
    throw new Error(`AI ranking error: ${rankResponse.status}`);
  }

  const rankData = await rankResponse.json();
  const toolCall = rankData.choices?.[0]?.message?.tool_calls?.[0];
  
  let rankings: { index: number; score: number }[] = [];
  if (toolCall?.function?.arguments) {
    try {
      const parsed = JSON.parse(toolCall.function.arguments);
      rankings = parsed.rankings || [];
    } catch {
      console.error("Failed to parse rankings");
    }
  }

  // Sort by score descending and take top N
  rankings.sort((a, b) => b.score - a.score);
  const topRankings = rankings.slice(0, nResults);

  // Get doc metadata
  const rankedChunks = topRankings
    .filter((r) => r.index >= 0 && r.index < candidates.length)
    .map((r) => ({ ...candidates[r.index], score: r.score }));

  const docIds = [...new Set(rankedChunks.map((c: any) => c.doc_id))];
  const { data: docs } = await supabase
    .from("documents")
    .select("id, title, source_type, source_path, tags")
    .in("id", docIds);

  const docMap = new Map((docs || []).map((d: any) => [d.id, d]));

  const results = rankedChunks.map((c: any) => {
    const doc = docMap.get(c.doc_id);
    return {
      text: c.content,
      metadata: {
        doc_id: c.doc_id,
        title: doc?.title || "Unknown",
        source_type: doc?.source_type || "text",
        source_path: doc?.source_path || "",
        chunk_index: c.chunk_index,
        tags: (doc?.tags || []).join(","),
      },
      score: c.score,
    };
  });

  return new Response(
    JSON.stringify({ query, results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
