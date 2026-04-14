import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function getEmbedding(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text.slice(0, 8000),
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("Embedding API error:", res.status, errorText);
    throw new Error(`Embedding API error: ${res.status}`);
  }

  const json = await res.json();
  return json.data[0].embedding;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, n_results = 8, doc_id } = await req.json();
    if (!query || typeof query !== "string") {
      return new Response(JSON.stringify({ error: "query string required" }), {
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

    // Generate embedding for the query
    const queryEmbedding = await getEmbedding(query, LOVABLE_API_KEY);

    // Use the search_chunks database function for vector similarity search
    const { data: matches, error: searchErr } = await supabase.rpc(
      "search_chunks",
      {
        query_embedding: JSON.stringify(queryEmbedding),
        match_count: Math.min(n_results, 20),
        filter_doc_id: doc_id || null,
      }
    );

    if (searchErr) throw new Error(searchErr.message);

    // Get document metadata for matched chunks
    const docIds = [...new Set((matches || []).map((m: any) => m.doc_id))];
    const { data: docs } = await supabase
      .from("documents")
      .select("id, title, source_type, source_path, tags")
      .in("id", docIds);

    const docMap = new Map((docs || []).map((d: any) => [d.id, d]));

    const results = (matches || []).map((m: any) => {
      const doc = docMap.get(m.doc_id);
      return {
        text: m.content,
        metadata: {
          doc_id: m.doc_id,
          title: doc?.title || "Unknown",
          source_type: doc?.source_type || "text",
          source_path: doc?.source_path || "",
          chunk_index: m.chunk_index,
          tags: (doc?.tags || []).join(","),
        },
        score: m.similarity,
      };
    });

    return new Response(
      JSON.stringify({ query, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("search error:", e);

    if (e instanceof Error && e.message.includes("429")) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded, please try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
