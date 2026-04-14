import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Rss, Plus, Trash2, RefreshCw, CheckCircle, AlertCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface Feed {
  id: string;
  url: string;
  title: string | null;
  last_fetched_at: string | null;
  is_active: boolean;
  article_count: number;
  created_at: string;
}

export default function SourcesPanel() {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    loadFeeds();
  }, []);

  async function loadFeeds() {
    setLoading(true);
    const { data, error } = await supabase
      .from("feeds")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error) setFeeds((data as Feed[]) || []);
    setLoading(false);
  }

  async function addFeed(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setAdding(true);
    setStatus(null);

    try {
      // Validate it's a URL
      new URL(url.trim());

      const { error } = await supabase.from("feeds").insert({ url: url.trim() });
      if (error) {
        if (error.code === "23505") {
          setStatus({ type: "error", message: "This feed URL is already added." });
        } else {
          throw new Error(error.message);
        }
      } else {
        setStatus({ type: "success", message: "Feed added! It will be synced within the hour." });
        setUrl("");
        await loadFeeds();
      }
    } catch (err) {
      setStatus({ type: "error", message: (err as Error).message });
    } finally {
      setAdding(false);
    }
  }

  async function removeFeed(id: string) {
    await supabase.from("feeds").delete().eq("id", id);
    setFeeds((prev) => prev.filter((f) => f.id !== id));
  }

  async function syncFeed(id: string) {
    setSyncing(id);
    setStatus(null);
    try {
      const { data, error } = await supabase.functions.invoke("ingest-feeds", {
        body: { feed_id: id },
      });
      if (error) throw new Error(error.message);
      const ingested = data?.ingested || 0;
      setStatus({
        type: "success",
        message: ingested > 0
          ? `Synced! ${ingested} new article${ingested > 1 ? "s" : ""} added to your nebula.`
          : "Feed is up to date — no new articles found.",
      });
      await loadFeeds();
    } catch (err) {
      setStatus({ type: "error", message: (err as Error).message });
    } finally {
      setSyncing(null);
    }
  }

  function timeAgo(dateStr: string | null) {
    if (!dateStr) return "Never";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold gradient-text font-display">Sources</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Connect RSS feeds to automatically ingest new articles into your nebula.
        </p>
      </div>

      {/* Add Feed Form */}
      <div className="glass rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2 text-foreground font-medium">
          <Rss size={18} className="text-primary" />
          Add RSS Feed
        </div>
        <form onSubmit={addFeed} className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/feed.xml"
            className="flex-1 bg-input border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
          />
          <button
            type="submit"
            disabled={adding}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-medium rounded-xl text-sm transition-colors"
          >
            <Plus size={15} />
            {adding ? "Adding…" : "Add"}
          </button>
        </form>
        <p className="text-xs text-muted-foreground">
          Feeds are checked automatically every hour for new articles.
        </p>
      </div>

      {/* Status Message */}
      {status && (
        <div
          className={cn(
            "flex items-center gap-2 text-sm rounded-lg px-3 py-2",
            status.type === "success"
              ? "bg-chart-5/10 text-chart-5 border border-chart-5/20"
              : "bg-destructive/10 text-destructive border border-destructive/20"
          )}
        >
          {status.type === "success" ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
          {status.message}
        </div>
      )}

      {/* Feed List */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Connected Feeds ({feeds.length})
        </h2>

        {loading ? (
          <div className="glass rounded-xl p-8 text-center text-muted-foreground text-sm">Loading…</div>
        ) : feeds.length === 0 ? (
          <div className="glass rounded-xl p-8 text-center text-muted-foreground text-sm">
            No feeds connected yet. Add an RSS feed URL above to get started.
          </div>
        ) : (
          feeds.map((feed) => (
            <div key={feed.id} className="glass rounded-xl p-4 flex items-center gap-3">
              <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center">
                <Rss size={16} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {feed.title || feed.url}
                </p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                  <span className="flex items-center gap-1">
                    <Clock size={10} />
                    {timeAgo(feed.last_fetched_at)}
                  </span>
                  <span>{feed.article_count} article{feed.article_count !== 1 ? "s" : ""}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => syncFeed(feed.id)}
                  disabled={syncing === feed.id}
                  className="p-2 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  title="Sync now"
                >
                  <RefreshCw size={15} className={syncing === feed.id ? "animate-spin" : ""} />
                </button>
                <button
                  onClick={() => removeFeed(feed.id)}
                  className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  title="Remove feed"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
