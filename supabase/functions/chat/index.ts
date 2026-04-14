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
    const { messages } = await req.json();
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
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

    // Extract the latest user message for retrieval
    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user");
    const query = lastUserMsg?.content || "";

    // --- Retrieval: find relevant chunks ---
    const keywords = query.split(/\s+/).filter((w: string) => w.length > 2);
    const orFilter = keywords.map((k: string) => `content.ilike.%${k}%`).join(",");

    let candidateQuery = supabase
      .from("chunks")
      .select("id, doc_id, chunk_index, content")
      .limit(30);

    if (orFilter) {
      candidateQuery = candidateQuery.or(orFilter);
    }

    let { data: candidates } = await candidateQuery;

    // Fallback if keyword search found nothing
    if (!candidates || candidates.length === 0) {
      const { data: fallback } = await supabase
        .from("chunks")
        .select("id, doc_id, chunk_index, content")
        .limit(20);
      candidates = fallback || [];
    }

    // Get doc metadata for context attribution
    let contextText = "";
    let sourceDocs: any[] = [];

    if (candidates.length > 0) {
      const docIds = [...new Set(candidates.map((c: any) => c.doc_id))];
      const { data: docs } = await supabase
        .from("documents")
        .select("id, title, source_type, source_path, tags")
        .in("id", docIds);

      const docMap = new Map((docs || []).map((d: any) => [d.id, d]));
      sourceDocs = (docs || []).map((d: any) => ({
        title: d.title,
        source_type: d.source_type,
        source_path: d.source_path,
      }));

      // Build context from top chunks (limit to ~6000 chars)
      let charBudget = 6000;
      const contextChunks: string[] = [];
      for (const chunk of candidates) {
        if (charBudget <= 0) break;
        const doc = docMap.get(chunk.doc_id);
        const label = doc?.title || "Unknown";
        const entry = `[From "${label}"]\n${chunk.content}`;
        contextChunks.push(entry);
        charBudget -= entry.length;
      }
      contextText = contextChunks.join("\n\n---\n\n");
    }

    // --- Generation: stream AI response with context ---
    const systemPrompt = contextText
      ? `You are Knowledge Nebula, an AI assistant that answers questions using the user's personal knowledge base. Ground your answers in the provided context. If the context doesn't contain enough information, say so honestly. Be concise but thorough. Use markdown formatting.

## Retrieved Context
${contextText}`
      : `You are Knowledge Nebula, an AI assistant. The user's knowledge base is currently empty. Encourage them to upload documents, notes, or URLs first, then come back to chat.`;

    const aiMessages = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: aiMessages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds in Settings > Workspace > Usage." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", status, errText);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Stream the response, prepending source metadata as a JSON event
    const encoder = new TextEncoder();
    const sourceEvent = `data: ${JSON.stringify({ sources: sourceDocs })}\n\n`;

    const readable = new ReadableStream({
      async start(controller) {
        // Send sources first
        controller.enqueue(encoder.encode(sourceEvent));
        
        // Pipe through the AI stream
        const reader = response.body!.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
