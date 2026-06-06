import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, MessageCircle, Search, ExternalLink, Calendar, Layers, Trash2 } from "lucide-react";
import { getDocument, deleteDocument } from "@/lib/api";
import { SOURCE_ICONS, SOURCE_COLORS, formatDate } from "@/lib/utils";
import { useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/doc/$id")({
  component: DocPage,
  head: () => ({
    meta: [
      { title: "Knowledge Point — Knowledge Nebula" },
      { name: "description", content: "Recap of a knowledge point from your nebula." },
    ],
  }),
});

function DocPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();

  const { data: doc, isLoading, error } = useQuery({
    queryKey: ["document", id],
    queryFn: () => getDocument(id),
  });

  const handleDelete = async () => {
    if (!doc) return;
    if (!confirm("Remove this knowledge point from your nebula?")) return;
    await deleteDocument(doc.id);
    navigate({ to: "/" });
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center">
        <p className="text-muted-foreground animate-pulse tracking-widest">Loading knowledge…</p>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center flex flex-col items-center gap-4">
        <p className="gradient-text text-2xl font-bold font-display">Knowledge not found</p>
        <p className="text-sm text-muted-foreground">This star may have drifted out of orbit.</p>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary/20 border border-primary/30 text-primary text-sm hover:bg-primary/30 transition-colors"
        >
          <ArrowLeft size={14} /> Back to nebula
        </Link>
      </div>
    );
  }

  const sourceLabel = doc.source_type;

  return (
    <div className="max-w-3xl mx-auto py-6 sm:py-10 px-1">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft size={12} /> Back to nebula
      </Link>

      {/* Header card */}
      <div className="glass rounded-2xl p-6 sm:p-8 mb-5 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none opacity-50"
          style={{
            background:
              "radial-gradient(80% 60% at 0% 0%, color-mix(in oklab, var(--primary) 18%, transparent), transparent 60%)",
          }}
        />
        <div className="relative">
          <div className="flex items-center gap-2 mb-3">
            <span
              className={`px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium border ${SOURCE_COLORS[sourceLabel] ?? ""}`}
            >
              <span className="mr-1">{SOURCE_ICONS[sourceLabel]}</span>
              {sourceLabel}
            </span>
            {doc.source_path && doc.source_type === "url" && (
              <a
                href={doc.source_path}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-nebula-blue hover:underline"
              >
                <ExternalLink size={11} /> Open source
              </a>
            )}
          </div>

          <h1 className="text-2xl sm:text-3xl font-display font-bold gradient-text leading-tight mb-3">
            {doc.title}
          </h1>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Calendar size={11} /> Added {formatDate(doc.created_at)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Layers size={11} /> {doc.chunk_count} chunk{doc.chunk_count !== 1 ? "s" : ""}
            </span>
          </div>

          {doc.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-4">
              {doc.tags.map((t) => (
                <span
                  key={t}
                  className="px-2.5 py-0.5 rounded-full text-[10px] bg-primary/15 text-primary border border-primary/25"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-6">
            <Link
              to="/chat"
              search={{ doc: doc.id }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary/20 border border-primary/30 text-primary text-sm hover:bg-primary/30 transition-colors"
            >
              <MessageCircle size={13} /> Chat with this
            </Link>
            <Link
              to="/search"
              search={{ q: doc.title }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-nebula-blue/15 border border-nebula-blue/30 text-nebula-blue text-sm hover:bg-nebula-blue/25 transition-colors"
            >
              <Search size={13} /> Search related
            </Link>
            <button
              onClick={handleDelete}
              className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm hover:bg-destructive/20 transition-colors"
            >
              <Trash2 size={13} /> Remove
            </button>
          </div>
        </div>
      </div>

      {/* Recap / content */}
      <div className="glass rounded-2xl p-6 sm:p-8">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60 mb-3">
          Recap
        </p>
        {doc.content ? (
          <article className="prose prose-invert prose-sm max-w-none text-foreground/90 whitespace-pre-wrap leading-relaxed">
            {doc.content}
          </article>
        ) : doc.content_preview ? (
          <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">
            {doc.content_preview}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground/60 italic">
            No recap stored for this knowledge point yet.
          </p>
        )}
      </div>
    </div>
  );
}