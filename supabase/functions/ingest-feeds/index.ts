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

    let feedFilter: string | null = null;
    try {
      const body = await req.json();
      feedFilter = body?.feed_id || null;
    } catch {
      // No body is fine — process all feeds
    }

    let query = supabase.from("feeds").select("*").eq("is_active", true);
    if (feedFilter) {
      query = query.eq("id", feedFilter);
    }

    const { data: feeds, error: feedErr } = await query;
    if (feedErr) throw new Error(feedErr.message);
    if (!feeds || feeds.length === 0) {
      return new Response(
        JSON.stringify({ message: "No active feeds to process", ingested: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch existing tags from all documents to help AI match existing topics
    const existingTags = await getExistingTags(supabase);

    let totalIngested = 0;
    const results: any[] = [];

    for (const feed of feeds) {
      try {
        const feedResult = await processFeed(supabase, feed, existingTags);
        totalIngested += feedResult.newArticles;
        results.push({ feed_id: feed.id, url: feed.url, ...feedResult });
      } catch (err) {
        console.error(`Error processing feed ${feed.url}:`, err);
        results.push({
          feed_id: feed.id,
          url: feed.url,
          error: err instanceof Error ? err.message : "Unknown error",
          newArticles: 0,
        });
      }
    }

    return new Response(
      JSON.stringify({ message: `Processed ${feeds.length} feeds`, ingested: totalIngested, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("ingest-feeds error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ── Existing tags ─────────────────────────────────────────────────────────────

async function getExistingTags(supabase: any): Promise<string[]> {
  const { data } = await supabase.from("documents").select("tags");
  if (!data) return [];
  const tagSet = new Set<string>();
  for (const doc of data) {
    if (doc.tags) {
      for (const t of doc.tags) {
        // Skip generic tags that shouldn't be reused as topics
        if (t !== "rss" && t.length > 1) tagSet.add(t);
      }
    }
  }
  return [...tagSet];
}

// ── AI topic extraction ───────────────────────────────────────────────────────

async function extractTopicTags(
  title: string,
  content: string,
  existingTags: string[]
): Promise<string[]> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    // Fallback: simple keyword extraction
    return fallbackExtractTags(title, content, existingTags);
  }

  const snippet = content.slice(0, 1500);
  const existingList = existingTags.length > 0
    ? `\nExisting topics in the knowledge base: ${existingTags.join(", ")}`
    : "";

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: `You are a topic classifier. Given an article title and content, return 1-4 short topic tags (1-2 words each, lowercase). 
IMPORTANT: Prefer matching existing topics when the article relates to them. Only create new topic tags when the content genuinely covers a new subject.${existingList}

Respond with ONLY a JSON array of strings, nothing else. Example: ["plants", "gardening", "indoor growing"]`,
          },
          {
            role: "user",
            content: `Title: ${title}\n\nContent: ${snippet}`,
          },
        ],
        temperature: 0.2,
        max_tokens: 100,
      }),
    });

    if (!res.ok) {
      console.error("AI tagging failed:", res.status);
      return fallbackExtractTags(title, content, existingTags);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim() || "";
    
    // Parse JSON array from response
    const match = text.match(/\[[\s\S]*?\]/);
    if (match) {
      const tags = JSON.parse(match[0]) as string[];
      return tags
        .filter((t: any) => typeof t === "string" && t.length > 0)
        .map((t: string) => t.toLowerCase().trim())
        .slice(0, 4);
    }
  } catch (err) {
    console.error("AI tagging error:", err);
  }

  return fallbackExtractTags(title, content, existingTags);
}

function fallbackExtractTags(
  title: string,
  content: string,
  existingTags: string[]
): string[] {
  // Simple keyword matching against existing tags
  const text = `${title} ${content.slice(0, 2000)}`.toLowerCase();
  const matched = existingTags.filter((tag) => text.includes(tag.toLowerCase()));

  if (matched.length > 0) return matched.slice(0, 4);

  // Extract simple topic from title words (skip common words)
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
    "has", "have", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "this", "that", "these", "those",
    "how", "what", "when", "where", "why", "who", "which", "its", "it",
    "new", "top", "best", "most", "more", "your", "you", "we", "our",
  ]);

  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  return words.slice(0, 2);
}

// ── Feed processing ───────────────────────────────────────────────────────────

async function processFeed(supabase: any, feed: any, existingTags: string[]) {
  const res = await fetch(feed.url, {
    headers: { "User-Agent": "KnowledgeNebula/1.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching feed`);

  const xml = await res.text();
  const articles = parseRSSorAtom(xml);

  if (articles.length === 0) {
    return { newArticles: 0, title: feed.title };
  }

  const feedTitle = extractFeedTitle(xml) || feed.title;
  if (!feed.title && feedTitle) {
    await supabase.from("feeds").update({ title: feedTitle }).eq("id", feed.id);
  }

  const lastFetched = feed.last_fetched_at ? new Date(feed.last_fetched_at) : new Date(0);
  const newArticles = articles.filter((a) => {
    if (!a.pubDate) return true;
    return new Date(a.pubDate) > lastFetched;
  });

  if (newArticles.length === 0) {
    await supabase.from("feeds").update({ last_fetched_at: new Date().toISOString() }).eq("id", feed.id);
    return { newArticles: 0, title: feedTitle };
  }

  const titles = newArticles.map((a) => a.title);
  const { data: existing } = await supabase
    .from("documents")
    .select("title")
    .eq("source_feed_id", feed.id)
    .in("title", titles);

  const existingTitles = new Set((existing || []).map((d: any) => d.title));
  const toIngest = newArticles.filter((a) => !existingTitles.has(a.title));

  let ingested = 0;
  for (const article of toIngest.slice(0, 20)) {
    try {
      await ingestArticle(supabase, feed.id, article, existingTags);
      ingested++;
    } catch (err) {
      console.error(`Error ingesting article "${article.title}":`, err);
    }
  }

  await supabase
    .from("feeds")
    .update({
      last_fetched_at: new Date().toISOString(),
      article_count: (feed.article_count || 0) + ingested,
    })
    .eq("id", feed.id);

  return { newArticles: ingested, title: feedTitle };
}

async function ingestArticle(supabase: any, feedId: string, article: any, existingTags: string[]) {
  const content = article.content || article.description || "";
  const plainContent = content.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  const preview = plainContent.slice(0, 500);

  // Use AI to extract real topic tags instead of generic "rss" labels
  const tags = await extractTopicTags(
    article.title || "Untitled",
    plainContent,
    existingTags
  );

  const { data: doc, error } = await supabase
    .from("documents")
    .insert({
      title: article.title || "Untitled Article",
      source_type: "url",
      source_path: article.link || null,
      content: plainContent,
      content_preview: preview,
      tags,
      source_feed_id: feedId,
      chunk_count: 1,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  const chunks = chunkText(plainContent, 1000, 200);
  if (chunks.length > 0) {
    await supabase.from("chunks").insert(
      chunks.map((text: string, i: number) => ({
        doc_id: doc.id,
        chunk_index: i,
        content: text,
      }))
    );
    await supabase
      .from("documents")
      .update({ chunk_count: chunks.length })
      .eq("id", doc.id);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function chunkText(text: string, size: number, overlap: number): string[] {
  if (!text || text.length === 0) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end));
    start += size - overlap;
    if (start >= text.length) break;
  }
  return chunks;
}

function extractFeedTitle(xml: string): string | null {
  const rssMatch = xml.match(/<channel[^>]*>[\s\S]*?<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
  if (rssMatch) return rssMatch[1].trim();
  const atomMatch = xml.match(/<feed[^>]*>[\s\S]*?<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
  if (atomMatch) return atomMatch[1].trim();
  return null;
}

interface Article {
  title: string;
  link: string | null;
  description: string | null;
  content: string | null;
  pubDate: string | null;
}

function parseRSSorAtom(xml: string): Article[] {
  const articles: Article[] = [];

  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    articles.push({
      title: extractTag(item, "title") || "Untitled",
      link: extractTag(item, "link"),
      description: extractTag(item, "description"),
      content: extractTag(item, "content:encoded") || extractTag(item, "content"),
      pubDate: extractTag(item, "pubDate") || extractTag(item, "dc:date"),
    });
  }

  if (articles.length > 0) return articles;

  const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];
    const linkMatch = entry.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/);
    articles.push({
      title: extractTag(entry, "title") || "Untitled",
      link: linkMatch ? linkMatch[1] : null,
      description: extractTag(entry, "summary"),
      content: extractTag(entry, "content"),
      pubDate: extractTag(entry, "published") || extractTag(entry, "updated"),
    });
  }

  return articles;
}

function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}
