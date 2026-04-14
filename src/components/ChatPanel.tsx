import { useEffect, useRef, useState } from "react";
import { cn, SOURCE_ICONS } from "@/lib/utils";
import { Send, Loader2, Bot, User, BookOpen } from "lucide-react";
import ReactMarkdown from "react-markdown";

type Source = {
  title: string;
  source_type: string;
  source_path: string;
};

type Msg = { role: "user" | "assistant"; content: string };

type DisplayMessage = Msg & {
  sources?: Source[];
  loading?: boolean;
};

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

const STARTERS = [
  "Summarize the key themes across my documents",
  "What are the most important concepts I've saved?",
  "What did I learn about AI recently?",
  "Find connections between my notes",
];

export default function ChatPanel() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
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

    const userMsg: DisplayMessage = { role: "user", content: q };
    const assistantMsg: DisplayMessage = { role: "assistant", content: "", loading: true };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    // Build conversation history for the API
    const history: Msg[] = [
      ...messages
        .filter((m) => !m.loading)
        .map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: q },
    ];

    try {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: history }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ error: "Request failed" }));
        throw new Error(errData.error || `Error ${resp.status}`);
      }

      if (!resp.body) throw new Error("No response stream");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let assistantSoFar = "";
      let sources: Source[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);

            // Check for our custom sources event
            if (parsed.sources) {
              sources = parsed.sources;
              continue;
            }

            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantSoFar += content;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: assistantSoFar,
                  sources,
                  loading: false,
                };
                return updated;
              });
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      // Final update
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: assistantSoFar || "I couldn't generate a response. Please try again.",
          sources,
          loading: false,
        };
        return updated;
      });
    } catch (err: any) {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: err?.message || "Something went wrong. Please try again.",
          loading: false,
        };
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
                  ) : msg.role === "assistant" ? (
                    <div className="prose prose-sm prose-invert max-w-none">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  )}
                </div>

                {msg.sources && msg.sources.length > 0 && !msg.loading && (
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
