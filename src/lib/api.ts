import { supabase } from "@/integrations/supabase/client";

export type SourceType = "pdf" | "text" | "markdown" | "docx" | "url" | "note";

export interface KnowledgeDoc {
  id: string;
  title: string;
  source_type: SourceType;
  source_path: string | null;
  content_preview: string | null;
  tags: string[];
  chunk_count: number;
  created_at: string;
}

export interface SearchHit {
  text: string;
  metadata: {
    doc_id: string;
    title: string;
    source_type: string;
    source_path: string;
    chunk_index: number;
    tags: string;
  };
  score: number;
}

export interface Stats {
  document_count: number;
  chunk_count: number;
  source_types: string[];
}

// ── Documents ────────────────────────────────────────────────────────────

export async function listDocuments(): Promise<KnowledgeDoc[]> {
  // Paginate to bypass Supabase's default 1000-row cap
  const pageSize = 1000;
  let from = 0;
  const all: any[] = [];
  while (true) {
    const { data, error } = await supabase
      .from("documents")
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all.map((d) => ({
    id: d.id,
    title: d.title,
    source_type: d.source_type as SourceType,
    source_path: d.source_path,
    content_preview: d.content_preview,
    tags: d.tags || [],
    chunk_count: d.chunk_count || 0,
    created_at: d.created_at,
  }));
}

export async function getStats(): Promise<Stats> {
  // Use exact count to avoid the 1000-row default cap
  const { count: docCount, error: docErr } = await supabase
    .from("documents")
    .select("*", { count: "exact", head: true });
  if (docErr) throw new Error(docErr.message);

  // Fetch source_types via pagination
  const pageSize = 1000;
  let from = 0;
  const types: string[] = [];
  while (true) {
    const { data, error } = await supabase
      .from("documents")
      .select("source_type")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    types.push(...data.map((d) => d.source_type));
    if (data.length < pageSize) break;
    from += pageSize;
  }

  const { count } = await supabase
    .from("chunks")
    .select("*", { count: "exact", head: true });

  return {
    document_count: docCount || 0,
    chunk_count: count || 0,
    source_types: [...new Set(types)],
  };
}

export async function deleteDocument(id: string): Promise<void> {
  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function ingestNote(
  title: string,
  content: string,
  tags: string[]
): Promise<KnowledgeDoc> {
  const preview = content.slice(0, 500);

  const { data, error } = await supabase
    .from("documents")
    .insert({
      title,
      source_type: "note",
      content,
      content_preview: preview,
      tags,
      chunk_count: 1,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Create a single chunk for the note
  await supabase.from("chunks").insert({
    doc_id: data.id,
    chunk_index: 0,
    content,
  });



  return {
    id: data.id,
    title: data.title,
    source_type: data.source_type as SourceType,
    source_path: data.source_path,
    content_preview: data.content_preview,
    tags: data.tags || [],
    chunk_count: data.chunk_count || 0,
    created_at: data.created_at,
  };
}

export async function uploadFile(
  file: File,
  tags: string[]
): Promise<KnowledgeDoc> {
  // Read file content as text
  const content = await file.text();
  const ext = file.name.split(".").pop()?.toLowerCase() || "text";

  const sourceType: SourceType =
    ext === "pdf"
      ? "pdf"
      : ext === "md"
        ? "markdown"
        : ext === "docx" || ext === "doc"
          ? "docx"
          : "text";

  const preview = content.slice(0, 500);

  // Upload file to storage
  const filePath = `${Date.now()}-${file.name}`;
  await supabase.storage.from("documents").upload(filePath, file);

  // Create document record
  const { data, error } = await supabase
    .from("documents")
    .insert({
      title: file.name,
      source_type: sourceType,
      source_path: filePath,
      content,
      content_preview: preview,
      tags,
      chunk_count: 1,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Simple chunking: split by paragraphs
  const chunks = chunkText(content, 1000, 200);
  if (chunks.length > 0) {
    await supabase.from("chunks").insert(
      chunks.map((text, i) => ({
        doc_id: data.id,
        chunk_index: i,
        content: text,
      }))
    );
    await supabase
      .from("documents")
      .update({ chunk_count: chunks.length })
      .eq("id", data.id);
  }



  return {
    id: data.id,
    title: data.title,
    source_type: data.source_type as SourceType,
    source_path: data.source_path,
    content_preview: data.content_preview,
    tags: data.tags || [],
    chunk_count: chunks.length,
    created_at: data.created_at,
  };
}

export async function ingestURL(
  url: string,
  tags: string[]
): Promise<KnowledgeDoc> {
  // For now, store URL as document with placeholder content
  const { data, error } = await supabase
    .from("documents")
    .insert({
      title: url,
      source_type: "url",
      source_path: url,
      content_preview: `Imported from ${url}`,
      tags,
      chunk_count: 0,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  return {
    id: data.id,
    title: data.title,
    source_type: data.source_type as SourceType,
    source_path: data.source_path,
    content_preview: data.content_preview,
    tags: data.tags || [],
    chunk_count: data.chunk_count || 0,
    created_at: data.created_at,
  };
}

// ── Semantic Search (via edge function + AI re-ranking) ──

export async function semanticSearch(
  query: string,
  nResults = 8,
  docId?: string
): Promise<{ query: string; results: SearchHit[] }> {
  const { data, error } = await supabase.functions.invoke("search", {
    body: { query, n_results: nResults, doc_id: docId },
  });

  if (error) throw new Error(error.message || "Search failed");
  return data as { query: string; results: SearchHit[] };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function chunkText(text: string, size: number, overlap: number): string[] {
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
