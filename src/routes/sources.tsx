import { createFileRoute } from "@tanstack/react-router";
import SourcesPanel from "@/components/SourcesPanel";

export const Route = createFileRoute("/sources")({
  component: SourcesPage,
});

function SourcesPage() {
  return <SourcesPanel />;
}
