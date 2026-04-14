import { useEffect, useState, useCallback, useRef } from "react";
import { Bell, Sparkles, Star, Check, RefreshCw, Search, Rss } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import FeedSuggestions from "@/components/FeedSuggestions";

interface Notification {
  id: string;
  type: "new_addition" | "recommendation";
  title: string;
  description: string | null;
  url: string | null;
  is_read: boolean;
  metadata: any;
  created_at: string;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [generating, setGenerating] = useState(false);
  const [feedSearch, setFeedSearch] = useState<{ topic: string; tags: string[] } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const fetchNotifications = useCallback(async () => {
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    if (!error && data) setNotifications(data as Notification[]);
  }, []);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  useEffect(() => {
    const channel = supabase
      .channel("notifications-bell")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, (payload) => {
        setNotifications((prev) => [payload.new as Notification, ...prev].slice(0, 30));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const markRead = async (id: string) => {
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  };

  const markAllRead = async () => {
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    await supabase.from("notifications").update({ is_read: true }).in("id", unreadIds);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  const generateRecommendations = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("recommend", { body: {} });
      if (error) throw error;
      if (data?.recommendations > 0) {
        toast.success(`${data.recommendations} new recommendations generated!`);
        await fetchNotifications();
      } else {
        toast.info("No new recommendations right now.");
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to generate recommendations");
    } finally {
      setGenerating(false);
    }
  };

  const handleSearchAction = (n: Notification) => {
    const searchQuery = n.title.replace(/^💡\s*/, "").replace(/^New:\s*/, "");
    if (!n.is_read) markRead(n.id);
    setOpen(false);
    navigate({ to: "/search", search: { q: searchQuery } });
  };

  const handleFindFeed = (n: Notification) => {
    const tags = (n.metadata?.tags as string[]) || [];
    const topic = n.title.replace(/^💡\s*/, "").replace(/^New:\s*/, "");
    if (!n.is_read) markRead(n.id);
    setOpen(false);
    setFeedSearch({ topic, tags });
  };

  const formatTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <>
      <div className="relative" ref={panelRef}>
        <button
          onClick={() => setOpen(!open)}
          className="relative p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="Notifications"
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-1 animate-in zoom-in-50">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-80 max-h-[480px] glass rounded-xl border border-border/50 shadow-2xl overflow-hidden flex flex-col z-50 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
              <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={generateRecommendations}
                  disabled={generating}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                  title="Generate new recommendations"
                >
                  {generating ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                </button>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    title="Mark all as read"
                  >
                    <Check size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-y-auto flex-1">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 px-4">
                  <Bell size={24} className="text-muted-foreground/30 mb-2" />
                  <p className="text-sm text-muted-foreground/60">No notifications yet</p>
                  <button
                    onClick={generateRecommendations}
                    disabled={generating}
                    className="mt-3 text-xs text-primary hover:underline disabled:opacity-50"
                  >
                    {generating ? "Generating..." : "Generate recommendations →"}
                  </button>
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className={cn(
                      "w-full text-left px-4 py-3 border-b border-border/10 transition-colors hover:bg-accent/10",
                      !n.is_read && "bg-primary/5"
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 flex-shrink-0">
                        {n.type === "recommendation" ? (
                          <Sparkles size={14} className="text-primary" />
                        ) : (
                          <Star size={14} className="text-primary" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          "text-xs leading-snug truncate",
                          !n.is_read ? "text-foreground font-medium" : "text-muted-foreground"
                        )}>
                          {n.title}
                        </p>
                        {n.description && (
                          <p className="text-[11px] text-muted-foreground/70 mt-0.5 line-clamp-2 leading-relaxed">
                            {n.description}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-muted-foreground/50">
                            {formatTime(n.created_at)}
                          </span>
                          {n.metadata?.tags && (
                            <div className="flex gap-1 flex-wrap">
                              {(n.metadata.tags as string[]).slice(0, 3).map((t) => (
                                <span key={t} className="px-1.5 py-0 rounded-full text-[9px] bg-primary/15 text-primary/80">
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-2">
                          <button
                            onClick={() => handleSearchAction(n)}
                            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                          >
                            <Search size={10} />
                            Search related
                          </button>
                          {n.type === "recommendation" && (
                            <button
                              onClick={() => handleFindFeed(n)}
                              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-accent text-muted-foreground hover:text-foreground hover:bg-accent/80 transition-colors"
                            >
                              <Rss size={10} />
                              Find feed
                            </button>
                          )}
                        </div>
                      </div>
                      {!n.is_read && (
                        <div className="mt-1 w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {feedSearch && (
        <FeedSuggestions
          topic={feedSearch.topic}
          tags={feedSearch.tags}
          open={true}
          onClose={() => setFeedSearch(null)}
        />
      )}
    </>
  );
}
