-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Create documents table
CREATE TABLE public.documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('pdf', 'text', 'markdown', 'docx', 'url', 'note')),
  source_path TEXT,
  content_preview TEXT,
  content TEXT,
  tags TEXT[] DEFAULT '{}',
  chunk_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create chunks table for semantic search
CREATE TABLE public.chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  doc_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding extensions.vector(384),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_chunks_doc_id ON public.chunks(doc_id);
CREATE INDEX idx_documents_source_type ON public.documents(source_type);
CREATE INDEX idx_documents_tags ON public.documents USING GIN(tags);

-- Enable RLS
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chunks ENABLE ROW LEVEL SECURITY;

-- Public access policies
CREATE POLICY "Allow all access to documents" ON public.documents FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to chunks" ON public.chunks FOR ALL USING (true) WITH CHECK (true);

-- Semantic search function
CREATE OR REPLACE FUNCTION public.search_chunks(
  query_embedding extensions.vector(384),
  match_count INTEGER DEFAULT 8,
  filter_doc_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  doc_id UUID,
  chunk_index INTEGER,
  content TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.doc_id,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.chunks c
  WHERE
    c.embedding IS NOT NULL
    AND (filter_doc_id IS NULL OR c.doc_id = filter_doc_id)
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for document uploads
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false);

CREATE POLICY "Anyone can upload documents" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'documents');
CREATE POLICY "Anyone can read documents" ON storage.objects FOR SELECT USING (bucket_id = 'documents');
CREATE POLICY "Anyone can delete documents" ON storage.objects FOR DELETE USING (bucket_id = 'documents');