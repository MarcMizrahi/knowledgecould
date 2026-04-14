import { createFileRoute } from "@tanstack/react-router";
import UploadPanel from "@/components/UploadPanel";

export const Route = createFileRoute("/upload")({
  component: UploadPage,
  head: () => ({
    meta: [
      { title: "Add Knowledge — Knowledge Nebula" },
      { name: "description", content: "Upload files, import URLs, or write notes to add to your knowledge base." },
    ],
  }),
});

function UploadPage() {
  return <UploadPanel />;
}
