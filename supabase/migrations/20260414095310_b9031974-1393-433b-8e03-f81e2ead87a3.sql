CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'auto-ingest-feeds',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://cdsarmotjqmeygdaldmi.supabase.co/functions/v1/ingest-feeds',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkc2FybW90anFtZXlnZGFsZG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxMjMxMDEsImV4cCI6MjA5MTY5OTEwMX0.IZ0W2J380pZAHt8XKWQc6BuXZcjfGGR490ENa2fzNMk"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);