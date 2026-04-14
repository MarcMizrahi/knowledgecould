import { useState } from "react";
import { Rss, Loader2, Check, ExternalLink, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface SuggestedFeed {
  title: string;
  url: string;
  description: string;
}

interface FeedSuggestionsProps {
  topic: string;
  tags: string[];
  open: boolean;
  onClose: () => void;
}

export default function FeedSuggestions({ topic, tags, open, onClose }: FeedSuggestionsProps) {
  const [feeds, setFeeds] = useState<SuggestedFeed[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [addedUrls, setAddedUrls] = useState<Set<string>>(new Set());
  const [addingUrl, setAddingUrl] = useState<string | null>(null);

  const search = async () => {
    setLoading(true);
    setSearched(true);
    try {
      const { data, error } = await supabase.functions.invoke("find-feeds", {
        body: { topic, tags },
      });
      if (error) throw error;
      setFeeds(data?.feeds || []);
    } catch (e) {
      console.error(e);
      toast.error("Failed to find feeds");
    } finally {
      setLoading(false);
    }
  };

  const addFeed = async (feed: SuggestedFeed) => {
    setAddingUrl(feed.url);
    try {
      const { error } = await supabase.from("feeds").insert({ url: feed.url, title: feed.title });
      if (error) {
        if (error.code === "23505") {
          toast.info("This feed is already in your sources.");
          setAddedUrls((prev) => new Set(prev).add(feed.url));
        } else {
          throw error;
        }
      } else {
        toast.success(`Added "${feed.title}" to your sources!`);
        setAddedUrls((prev) => new Set(prev).add(feed.url));
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to add feed");
    } finally {
      setAddingUrl(null);
    }
  };

  // Auto-search on first open
  if (open && !searched && !loading) {
    search();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-24">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-md mx-4 glass rounded-2xl border border-border/50 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
          <div className="flex items-center gap-2">
            <Rss size={16} className="text-primary" />
            <h3 className="text-sm font-semibold text-foreground">RSS Feeds for "{topic}"</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[400px] overflow-y-auto p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10">
              <Loader2 size={24} className="text-primary animate-spin mb-3" />
              <p className="text-sm text-muted-foreground">Searching for RSS feeds...</p>
            </div>
          ) : feeds.length === 0 && searched ? (
            <div className="flex flex-col items-center justify-center py-10">
              <Rss size={24} className="text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No feeds found for this topic</p>
            </div>
          ) : (
            <div className="space-y-2">
              {feeds.map((feed) => {
                const isAdded = addedUrls.has(feed.url);
                const isAdding = addingUrl === feed.url;

                return (
                  <div
                    key={feed.url}
                    className={cn(
                      "rounded-xl p-3 border transition-colors",
                      isAdded
                        ? "border-primary/30 bg-primary/5"
                        : "border-border/30 bg-accent/5 hover:bg-accent/10"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{feed.title}</p>
                        <p className="text-[11px] text-muted-foreground/70 mt-0.5 line-clamp-2">
                          {feed.description}
                        </p>
                        <a
                          href={feed.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-primary/60 hover:text-primary mt-1 flex items-center gap-1 truncate"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink size={9} />
                          {feed.url}
                        </a>
                      </div>
                      <button
                        onClick={() => !isAdded && addFeed(feed)}
                        disabled={isAdded || isAdding}
                        className={cn(
                          "flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5",
                          isAdded
                            ? "bg-primary/20 text-primary cursor-default"
                            : "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        )}
                      >
                        {isAdding ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : isAdded ? (
                          <>
                            <Check size={12} /> Added
                          </>
                        ) : (
                          <>
                            <Rss size={12} /> Add
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
