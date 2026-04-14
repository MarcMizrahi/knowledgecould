import { useState, useEffect, useRef } from "react";
import { semanticSearch, type SearchHit } from "@/lib/api";
import { cn, SOURCE_COLORS, SOURCE_ICONS } from "@/lib/utils";
import { Search, Loader2 } from "lucide-react";

interface SearchPanelProps {
  initialQuery?: string;
}

export default function SearchPanel({ initialQuery }: SearchPanelProps) {
  const [query, setQuery] = useState(initialQuery || "");
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState("");
  const autoSearched = useRef(false);

  // Auto-search when initialQuery is provided
  useEffect(() => {
    if (initialQuery && !autoSearched.current) {
      autoSearched.current = true;
      setQuery(initialQuery);
      runSearch(initialQuery);
    }
  }, [initialQuery]);

  async function runSearch(q: string) {
    if (!q.trim()) return;
    setLoading(true);
    try {
      const { results: hits } = await semanticSearch(q.trim(), 8);
      setResults(hits);
      setSearched(q.trim());
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    runSearch(query);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold gradient-text font-display">Semantic Search</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Find knowledge by meaning, not just keywords
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='What do you want to find?'
          className="flex-1 bg-input border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="px-5 py-3 sm:py-0 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          Search
        </button>
      </form>

      {results !== null && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {results.length} result{results.length !== 1 ? "s" : ""} for{" "}
            <span className="text-foreground">&ldquo;{searched}&rdquo;</span>
          </p>

          {results.length === 0 ? (
            <div className="glass rounded-2xl p-8 text-center">
              <div className="text-4xl mb-3">🔭</div>
              <p className="text-foreground font-medium">No matching knowledge found</p>
              <p className="text-muted-foreground text-sm mt-1">
                Try different keywords or add more documents
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {results.map((hit, i) => (
                <div key={i} className="glass rounded-xl p-4 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="shrink-0">
                        {SOURCE_ICONS[hit.metadata.source_type] ?? "📄"}
                      </span>
                      <span className="text-foreground text-sm font-medium truncate">
                        {hit.metadata.title}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-xs px-2 py-0.5 rounded-full border",
                          SOURCE_COLORS[hit.metadata.source_type] ??
                            "bg-muted text-muted-foreground border-border"
                        )}
                      >
                        {hit.metadata.source_type}
                      </span>
                    </div>
                    <div className="shrink-0 flex items-center sm:block sm:text-right gap-2">
                      <span className="text-xs text-muted-foreground">
                        {(hit.score * 100).toFixed(0)}% match
                      </span>
                      <div
                        className="score-bar mt-0 sm:mt-1 w-16"
                        style={{ width: `${hit.score * 100}%`, maxWidth: 64 }}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-secondary-foreground leading-relaxed bg-accent/30 rounded-lg p-3">
                    {hit.text}
                  </p>
                  {hit.metadata.tags && (
                    <div className="flex flex-wrap gap-1">
                      {hit.metadata.tags
                        .split(",")
                        .filter(Boolean)
                        .map((tag) => (
                          <span
                            key={tag}
                            className="text-xs bg-nebula-blue/10 text-nebula-blue border border-nebula-blue/20 px-2 py-0.5 rounded-full"
                          >
                            {tag}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
