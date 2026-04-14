import { useEffect, useRef, useState } from "react";
import { cn, SOURCE_ICONS } from "@/lib/utils";
import { Send, Loader2, Bot, User, BookOpen } from "lucide-react";
import { semanticSearch } from "@/lib/api";

type Source = {
  title: string;
  source_type: string;
  source_path: string;
  score: number;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  loading?: boolean;
};

const STARTERS = [
  "Summarize the key themes across my documents",
  "What are the most important concepts I've saved?",
  "What did I learn about AI recently?",
  "Find connections between my notes",
];

export default function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(question: string) {
    if (!question.trim() || busy) return;
    const q = question.trim();
    setInput("");
    setBusy(true);

    setMessages((prev) => [
      ...prev,
      { role: "user", content: q },
      { role: "assistant", content: "", loading: true },
    ]);

    try {
      // Search for relevant chunks
      const { results } = await semanticSearch(q, 6);
      const sources: Source[] = results.map((r) => ({
        title: r.metadata.title,
        source_type: r.metadata.source_type,
        source_path: r.metadata.source_path,
        score: r.score,
      }));

      // Build a simple response from search results
      let responseText: string;
      if (results.length === 0) {
        responseText = "I couldn't find any relevant knowledge in your nebula. Try uploading some documents first, then ask me again!";
      } else {
        const context = results.map((r) => r.text).join("\n\n---\n\n");
        responseText = `Based on your knowledge base, here's what I found:\n\n${context}\n\n*Note: Full AI-powered RAG chat requires an AI API key to be configured. Currently showing relevant document excerpts.*`;
      }

      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role === "assistant") {
          updated[updated.length - 1] = {
            ...last,
            content: responseText,
            sources,
            loading: false,
          };
        }
        return updated;
      });
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role === "assistant") {
          updated[updated.length - 1] = {
            ...last,
            content: "Something went wrong. Please try again.",
            loading: false,
          };
        }
        return updated;
      });
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-10rem)]">
      <div className="mb-4">
        <h1 className="text-3xl font-bold gradient-text font-display">Chat with Knowledge</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Ask anything — answers are grounded in your documents
        </p>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-6">
            <div className="text-5xl">🌌</div>
            <div>
              <h2 className="text-xl font-semibold text-foreground font-display">
                Ask your Knowledge Nebula
              </h2>
              <p className="text-muted-foreground text-sm mt-1">
                Questions are answered using your uploaded documents
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 max-w-lg">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="glass hover:bg-accent text-secondary-foreground text-xs px-3 py-2.5 rounded-xl text-left transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                "flex gap-3",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {msg.role === "assistant" && (
                <div className="shrink-0 w-8 h-8 rounded-full bg-primary/30 flex items-center justify-center mt-0.5">
                  <Bot size={14} className="text-primary" />
                </div>
              )}
              <div
                className={cn(
                  "max-w-[80%] space-y-2",
                  msg.role === "user" ? "items-end" : "items-start"
                )}
              >
                <div
                  className={cn(
                    "rounded-2xl px-4 py-3 text-sm leading-relaxed",
                    msg.role === "user"
                      ? "bg-primary/30 text-foreground rounded-tr-sm"
                      : "glass text-foreground rounded-tl-sm"
                  )}
                >
                  {msg.loading ? (
                    <Loader2 size={14} className="animate-spin text-primary" />
                  ) : (
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  )}
                </div>

                {msg.sources && msg.sources.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <BookOpen size={11} />
                      Sources
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {msg.sources.slice(0, 4).map((src, j) => (
                        <div
                          key={j}
                          className="flex items-center gap-1 text-xs glass px-2 py-1 rounded-lg text-muted-foreground"
                        >
                          <span>{SOURCE_ICONS[src.source_type] ?? "📄"}</span>
                          <span className="max-w-32 truncate">{src.title}</span>
                          <span className="text-primary">
                            {(src.score * 100).toFixed(0)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {msg.role === "user" && (
                <div className="shrink-0 w-8 h-8 rounded-full bg-nebula-blue/30 flex items-center justify-center mt-0.5">
                  <User size={14} className="text-nebula-blue" />
                </div>
              )}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="mt-4 glass rounded-2xl p-3 flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question about your knowledge… (Enter to send)"
          rows={1}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none resize-none max-h-32"
        />
        <button
          onClick={() => send(input)}
          disabled={busy || !input.trim()}
          className="shrink-0 w-9 h-9 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-40 flex items-center justify-center transition-colors"
        >
          {busy ? (
            <Loader2 size={15} className="animate-spin text-primary-foreground" />
          ) : (
            <Send size={15} className="text-primary-foreground" />
          )}
        </button>
      </div>
    </div>
  );
}
