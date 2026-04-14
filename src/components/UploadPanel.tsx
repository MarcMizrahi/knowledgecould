import { useRef, useState } from "react";
import { ingestNote, ingestURL, uploadFile } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Upload, Link as LinkIcon, FileText, CheckCircle, AlertCircle, X } from "lucide-react";

type Tab = "file" | "url" | "note";
type Status = { type: "success" | "error"; message: string } | null;

function TagInput({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");

  function add() {
    const val = input.trim();
    if (val && !tags.includes(val)) {
      onChange([...tags, val]);
    }
    setInput("");
  }

  return (
    <div className="space-y-2">
      <label className="text-sm text-muted-foreground">Tags (optional)</label>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add a tag…"
          className="flex-1 bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
        />
        <button
          type="button"
          onClick={add}
          className="px-3 py-2 bg-primary/30 hover:bg-primary/50 text-primary rounded-lg text-sm transition-colors"
        >
          Add
        </button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <span
              key={t}
              className="flex items-center gap-1 text-xs bg-nebula-blue/10 text-nebula-blue border border-nebula-blue/20 px-2 py-0.5 rounded-full"
            >
              {t}
              <button onClick={() => onChange(tags.filter((x) => x !== t))}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function UploadPanel() {
  const [tab, setTab] = useState<Tab>("file");
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");

  function onFileChange(file: File | null) {
    setSelectedFile(file);
    setStatus(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setStatus(null);

    try {
      if (tab === "file") {
        if (!selectedFile) throw new Error("Please select a file");
        await uploadFile(selectedFile, tags);
        setStatus({ type: "success", message: `"${selectedFile.name}" added to your nebula!` });
        setSelectedFile(null);
        if (fileRef.current) fileRef.current.value = "";
      } else if (tab === "url") {
        if (!url.trim()) throw new Error("Please enter a URL");
        await ingestURL(url.trim(), tags);
        setStatus({ type: "success", message: "URL ingested successfully!" });
        setUrl("");
      } else {
        if (!noteTitle.trim()) throw new Error("Please enter a title");
        if (!noteContent.trim()) throw new Error("Please enter some content");
        await ingestNote(noteTitle.trim(), noteContent.trim(), tags);
        setStatus({ type: "success", message: `Note "${noteTitle}" saved to your nebula!` });
        setNoteTitle("");
        setNoteContent("");
      }
      setTags([]);
    } catch (err) {
      setStatus({ type: "error", message: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "file", label: "File", icon: <Upload size={15} /> },
    { id: "url", label: "URL", icon: <LinkIcon size={15} /> },
    { id: "note", label: "Note", icon: <FileText size={15} /> },
  ];

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold gradient-text font-display">Add Knowledge</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Upload files, import URLs, or write notes — they&apos;ll be chunked and indexed for search and chat.
        </p>
      </div>

      <div className="glass rounded-2xl p-6 space-y-5">
        {/* Tabs */}
        <div className="flex gap-1 bg-accent p-1 rounded-lg">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                setStatus(null);
              }}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-sm font-medium transition-colors",
                tab === t.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {tab === "file" && (
            <div>
              <div
                className={cn(
                  "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
                  dragOver
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-muted-foreground",
                  selectedFile && "border-chart-5/40 bg-chart-5/5"
                )}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files[0];
                  if (f) onFileChange(f);
                }}
              >
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.txt,.md,.docx,.doc"
                  onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
                />
                {selectedFile ? (
                  <div className="space-y-1">
                    <div className="text-chart-5 text-3xl">✓</div>
                    <p className="text-foreground font-medium">{selectedFile.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload size={32} className="mx-auto text-muted-foreground" />
                    <p className="text-foreground font-medium">Drop a file or click to browse</p>
                    <p className="text-xs text-muted-foreground">PDF, TXT, MD, DOCX — up to 50 MB</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "url" && (
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Web URL</label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/article"
                className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
              />
              <p className="text-xs text-muted-foreground">
                We&apos;ll fetch the page content and index it.
              </p>
            </div>
          )}

          {tab === "note" && (
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Title</label>
                <input
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  placeholder="My note title"
                  className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Content</label>
                <textarea
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="Write or paste your knowledge here…"
                  rows={6}
                  className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring resize-none"
                />
              </div>
            </div>
          )}

          <TagInput tags={tags} onChange={setTags} />

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

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-medium py-2.5 rounded-xl transition-colors"
          >
            {loading ? "Processing…" : "Add to Nebula"}
          </button>
        </form>
      </div>
    </div>
  );
}
