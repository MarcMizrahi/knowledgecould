import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function getEmbedding(text: string, apiKey: string): Promise<number[]> {
  // Use Lovable AI Gateway chat completions to generate a pseudo-embedding
  // by asking the model to produce a numerical representation
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
    const { doc_id } = await req.json();
    if (!doc_id) {
      return new Response(JSON.stringify({ error: "doc_id required" }), {
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

    // Fetch chunks for this document
    const { data: chunks, error: chunkErr } = await supabase
      .from("chunks")
      .select("id, content")
      .eq("doc_id", doc_id)
      .is("embedding", null);

    if (chunkErr) throw new Error(chunkErr.message);
    if (!chunks || chunks.length === 0) {
      return new Response(
        JSON.stringify({ message: "No unembedded chunks found", embedded: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Embedding ${chunks.length} chunks for doc ${doc_id}`);

    let embedded = 0;
    for (const chunk of chunks) {
      try {
        const embedding = await getEmbedding(chunk.content, LOVABLE_API_KEY);
        const { error: updateErr } = await supabase
          .from("chunks")
          .update({ embedding: JSON.stringify(embedding) })
          .eq("id", chunk.id);

        if (updateErr) {
          console.error(`Failed to update chunk ${chunk.id}:`, updateErr.message);
        } else {
          embedded++;
        }
      } catch (e) {
        console.error(`Failed to embed chunk ${chunk.id}:`, e);
      }
    }

    return new Response(
      JSON.stringify({ message: `Embedded ${embedded}/${chunks.length} chunks`, embedded }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("embed error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
