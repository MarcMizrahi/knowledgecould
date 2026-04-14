import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
    const { topic, tags } = await req.json();

    if (!topic || typeof topic !== "string" || topic.length > 500) {
      return new Response(
        JSON.stringify({ error: "Valid topic is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "AI not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tagContext = tags?.length > 0 ? `Related topics: ${tags.join(", ")}` : "";

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are an RSS feed discovery expert. Given a topic, suggest 4-6 real, well-known RSS feeds that cover it.

Each suggestion must include:
- "title": The name of the blog/publication
- "url": The actual RSS/Atom feed URL (must end in /rss, /feed, /atom.xml, or similar — NOT just the website homepage)
- "description": One sentence about what it covers

IMPORTANT: Only suggest feeds you are confident actually exist. Prefer major publications, well-known blogs, and established sources. Use common RSS URL patterns like:
- https://example.com/feed
- https://example.com/rss
- https://example.com/feed.xml
- https://example.com/atom.xml
- https://feeds.feedburner.com/example

Respond with ONLY a JSON array. No markdown, no explanation.`,
          },
          {
            role: "user",
            content: `Find RSS feeds about: ${topic}\n${tagContext}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 600,
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
      throw new Error(`AI request failed: ${status}`);
    }

    const aiData = await res.json();
    const text = aiData.choices?.[0]?.message?.content?.trim() || "";

    const match = text.match(/\[[\s\S]*\]/);
    if (!match) {
      return new Response(
        JSON.stringify({ feeds: [], message: "Could not parse response" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const feeds = JSON.parse(match[0]) as Array<{
      title: string;
      url: string;
      description: string;
    }>;

    // Validate URLs
    const validFeeds = feeds.filter((f) => {
      try {
        new URL(f.url);
        return f.title && f.url && f.description;
      } catch {
        return false;
      }
    });

    return new Response(
      JSON.stringify({ feeds: validFeeds }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("find-feeds error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
