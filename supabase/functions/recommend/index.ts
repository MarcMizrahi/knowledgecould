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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "AI not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Gather existing knowledge profile
    const { data: docs } = await supabase
      .from("documents")
      .select("title, tags, source_type, created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    if (!docs || docs.length === 0) {
      return new Response(
        JSON.stringify({ recommendations: [], message: "No documents yet" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Build a profile of interests: tag frequency + recency weighting
    const tagWeight = new Map<string, number>();
    const now = Date.now();
    for (const doc of docs) {
      if (!doc.tags) continue;
      // Recency weight: recent docs count more
      const age = (now - new Date(doc.created_at).getTime()) / (1000 * 60 * 60 * 24); // days
      const recencyBoost = Math.max(0.3, 1 - age / 90); // decays over 90 days
      for (const tag of doc.tags) {
        tagWeight.set(tag, (tagWeight.get(tag) || 0) + recencyBoost);
      }
    }

    // Sort by weight descending
    const topInterests = [...tagWeight.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([tag, weight]) => ({ tag, weight: Math.round(weight * 10) / 10 }));

    // 3. Check previously accepted/dismissed recommendations
    const { data: pastRecs } = await supabase
      .from("notifications")
      .select("title, metadata")
      .eq("type", "recommendation")
      .order("created_at", { ascending: false })
      .limit(20);

    const pastTitles = new Set((pastRecs || []).map(r => r.title));

    // 4. Ask AI for personalized recommendations
    const interestProfile = topInterests
      .map(i => `${i.tag} (weight: ${i.weight})`)
      .join(", ");

    const recentTitles = docs.slice(0, 15).map(d => d.title).join("\n- ");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are a knowledge curator. Given a user's topic interests and recent readings, suggest 3-5 specific articles, books, concepts, or topics they should explore next.

Each recommendation should:
- Be specific (not just "read more about X")
- Bridge between existing interests or deepen a niche
- Include a title, brief description (1-2 sentences), and 1-3 relevant topic tags
- Favor depth over breadth — help the user become an expert in their areas

Respond with ONLY a JSON array of objects with keys: "title", "description", "tags", "reason"
The "reason" field should explain why this recommendation fits their profile.`,
          },
          {
            role: "user",
            content: `My interest profile (weighted by recency):
${interestProfile}

My recent readings:
- ${recentTitles}

Previously recommended (avoid repeating):
${[...pastTitles].slice(0, 10).join(", ") || "None"}

Suggest 3-5 new things I should explore.`,
          },
        ],
        temperature: 0.7,
        max_tokens: 800,
      }),
    });

    if (!res.ok) {
      const status = res.status;
      if (status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limited, try again later" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error(`AI request failed: ${status}`);
    }

    const aiData = await res.json();
    const text = aiData.choices?.[0]?.message?.content?.trim() || "";

    const match = text.match(/\[[\s\S]*\]/);
    if (!match) {
      return new Response(
        JSON.stringify({ recommendations: [], message: "Could not parse AI response" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const recommendations = JSON.parse(match[0]) as Array<{
      title: string;
      description: string;
      tags: string[];
      reason: string;
    }>;

    // 5. Store as notifications
    const notifications = recommendations
      .filter(r => !pastTitles.has(`💡 ${r.title}`))
      .map(r => ({
        type: "recommendation" as const,
        title: `💡 ${r.title}`,
        description: `${r.description}\n\n${r.reason}`,
        metadata: { tags: r.tags, reason: r.reason },
      }));

    if (notifications.length > 0) {
      await supabase.from("notifications").insert(notifications);
    }

    return new Response(
      JSON.stringify({
        recommendations: notifications.length,
        interests: topInterests.slice(0, 8),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("recommend error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
