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

    // Optional: ingest a single feed by id
    let feedFilter: string | null = null;
    try {
      const body = await req.json();
      feedFilter = body?.feed_id || null;
    } catch {
      // No body is fine — process all feeds
    }

    // Get active feeds
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

    let totalIngested = 0;
    const results: any[] = [];

    for (const feed of feeds) {
      try {
        const feedResult = await processFeed(supabase, feed);
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

async function processFeed(supabase: any, feed: any) {
  // Fetch the RSS/Atom feed
  const res = await fetch(feed.url, {
    headers: { "User-Agent": "KnowledgeNebula/1.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching feed`);

  const xml = await res.text();
  const articles = parseRSSorAtom(xml);

  if (articles.length === 0) {
    return { newArticles: 0, title: feed.title };
  }

  // Update feed title from the feed itself if we don't have one
  const feedTitle = extractFeedTitle(xml) || feed.title;
  if (!feed.title && feedTitle) {
    await supabase.from("feeds").update({ title: feedTitle }).eq("id", feed.id);
  }

  // Filter to only new articles (published after last_fetched_at)
  const lastFetched = feed.last_fetched_at ? new Date(feed.last_fetched_at) : new Date(0);
  const newArticles = articles.filter((a) => {
    if (!a.pubDate) return true; // Include articles without dates
    return new Date(a.pubDate) > lastFetched;
  });

  if (newArticles.length === 0) {
    // Update last_fetched_at even if no new articles
    await supabase.from("feeds").update({ last_fetched_at: new Date().toISOString() }).eq("id", feed.id);
    return { newArticles: 0, title: feedTitle };
  }

  // Check for duplicates by title
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
    // Limit to 20 per run to avoid timeouts
    try {
      await ingestArticle(supabase, feed.id, article, feedTitle);
      ingested++;
    } catch (err) {
      console.error(`Error ingesting article "${article.title}":`, err);
    }
  }

  // Update feed stats
  await supabase
    .from("feeds")
    .update({
      last_fetched_at: new Date().toISOString(),
      article_count: (feed.article_count || 0) + ingested,
    })
    .eq("id", feed.id);

  return { newArticles: ingested, title: feedTitle };
}

async function ingestArticle(supabase: any, feedId: string, article: any, feedTitle: string) {
  const content = article.content || article.description || "";
  // Strip HTML tags for plain text
  const plainContent = content.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  const preview = plainContent.slice(0, 500);

  const tags = ["rss", feedTitle].filter(Boolean);

  // Create document
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

  // Chunk the content
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
  // Try RSS <title>
  const rssMatch = xml.match(/<channel[^>]*>[\s\S]*?<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
  if (rssMatch) return rssMatch[1].trim();

  // Try Atom <title>
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

  // Try RSS 2.0 <item> elements
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

  // Try Atom <entry> elements
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
