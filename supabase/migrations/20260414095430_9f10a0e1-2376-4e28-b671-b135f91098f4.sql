-- Notifications table
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('new_addition', 'recommendation')),
  title text NOT NULL,
  description text,
  url text,
  is_read boolean NOT NULL DEFAULT false,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to notifications"
  ON public.notifications FOR ALL
  USING (true)
  WITH CHECK (true);

-- Index for unread notifications
CREATE INDEX idx_notifications_unread ON public.notifications (is_read, created_at DESC);

-- Trigger: auto-create notification on new document insert
CREATE OR REPLACE FUNCTION public.notify_new_document()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (type, title, description, metadata)
  VALUES (
    'new_addition',
    'New: ' || LEFT(NEW.title, 80),
    COALESCE(LEFT(NEW.content_preview, 150), 'A new document was added to your nebula.'),
    jsonb_build_object('doc_id', NEW.id, 'source_type', NEW.source_type, 'tags', NEW.tags)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_document_insert
  AFTER INSERT ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_new_document();

-- Enable realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;