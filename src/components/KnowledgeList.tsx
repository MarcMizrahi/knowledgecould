import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { deleteDocument, getStats, listDocuments, type KnowledgeDoc, type Stats } from "@/lib/api";
import { cn, formatDate, SOURCE_COLORS, SOURCE_ICONS } from "@/lib/utils";
import { Trash2, Plus, Search, MessageSquare } from "lucide-react";

export default function KnowledgeList() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [d, s] = await Promise.all([listDocuments(), getStats()]);
      setDocs(d);
      setStats(s);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await deleteDocument(id);
      setDocs((prev) => prev.filter((d) => d.id !== id));
      setStats((s) =>
        s ? { ...s, document_count: s.document_count - 1 } : s
      );
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-text font-display">Your Knowledge</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            All the documents, notes, and URLs in your nebula
          </p>
        </div>
        <Link
          to="/upload"
          className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium px-4 py-2 rounded-xl transition-colors"
        >
          <Plus size={15} />
          Add
        </Link>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Documents", value: stats.document_count, emoji: "📚" },
            { label: "Chunks", value: stats.chunk_count, emoji: "🧩" },
            { label: "Types", value: stats.source_types.length, emoji: "📊" },
          ].map((s) => (
            <div key={s.label} className="glass rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-foreground">
                {s.emoji} {s.value}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Quick links */}
      <div className="flex gap-2">
        <Link
          to="/search"
          className="flex items-center gap-1.5 glass px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <Search size={13} />
          Search
        </Link>
        <Link
          to="/chat"
          className="flex items-center gap-1.5 glass px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <MessageSquare size={13} />
          Chat
        </Link>
      </div>

      {/* Document list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass rounded-xl p-4 animate-pulse">
              <div className="h-4 bg-accent rounded w-1/3" />
              <div className="h-3 bg-accent rounded w-2/3 mt-2" />
            </div>
          ))}
        </div>
      ) : docs.length === 0 ? (
        <div className="glass rounded-2xl p-10 text-center space-y-3">
          <div className="text-5xl">🌌</div>
          <h2 className="text-xl font-semibold text-foreground font-display">
            Your nebula is empty
          </h2>
          <p className="text-muted-foreground text-sm">
            Upload documents, import URLs, or write notes to start building your knowledge universe.
          </p>
          <Link
            to="/upload"
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
          >
            <Plus size={15} />
            Add your first document
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => (
            <div
              key={doc.id}
              className="glass rounded-xl p-4 flex items-start gap-3 group"
            >
              <span className="text-xl shrink-0 mt-0.5">
                {SOURCE_ICONS[doc.source_type] ?? "📄"}
              </span>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-foreground truncate">
                    {doc.title}
                  </h3>
                  <span
                    className={cn(
                      "shrink-0 text-xs px-2 py-0.5 rounded-full border",
                      SOURCE_COLORS[doc.source_type] ??
                        "bg-muted text-muted-foreground border-border"
                    )}
                  >
                    {doc.source_type}
                  </span>
                </div>
                {doc.content_preview && (
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {doc.content_preview}
                  </p>
                )}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{formatDate(doc.created_at)}</span>
                  <span>{doc.chunk_count} chunks</span>
                  {doc.tags.length > 0 && (
                    <div className="flex gap-1">
                      {doc.tags.map((t) => (
                        <span
                          key={t}
                          className="bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded-full"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleDelete(doc.id)}
                disabled={deleting === doc.id}
                className="shrink-0 opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
