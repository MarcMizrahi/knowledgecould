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
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data || []).map((d) => ({
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
  const { data: docs, error } = await supabase
    .from("documents")
    .select("source_type");

  if (error) throw new Error(error.message);

  const { count } = await supabase
    .from("chunks")
    .select("*", { count: "exact", head: true });

  return {
    document_count: docs?.length || 0,
    chunk_count: count || 0,
    source_types: [...new Set(docs?.map((d) => d.source_type) || [])],
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

// ── Search (text-based for now, semantic search via edge function later) ──

export async function semanticSearch(
  query: string,
  nResults = 8,
  docId?: string
): Promise<{ query: string; results: SearchHit[] }> {
  // Basic text search using ilike on chunks
  let q = supabase
    .from("chunks")
    .select("id, doc_id, chunk_index, content")
    .ilike("content", `%${query}%`)
    .limit(nResults);

  if (docId) {
    q = q.eq("doc_id", docId);
  }

  const { data: chunks, error } = await q;
  if (error) throw new Error(error.message);

  // Get doc metadata for matched chunks
  const docIds = [...new Set(chunks?.map((c) => c.doc_id) || [])];
  const { data: docs } = await supabase
    .from("documents")
    .select("id, title, source_type, source_path, tags")
    .in("id", docIds);

  const docMap = new Map(docs?.map((d) => [d.id, d]) || []);

  return {
    query,
    results: (chunks || []).map((c) => {
      const doc = docMap.get(c.doc_id);
      return {
        text: c.content,
        metadata: {
          doc_id: c.doc_id,
          title: doc?.title || "Unknown",
          source_type: doc?.source_type || "text",
          source_path: doc?.source_path || "",
          chunk_index: c.chunk_index,
          tags: (doc?.tags || []).join(","),
        },
        score: 0.8, // placeholder score for text search
      };
    }),
  };
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
