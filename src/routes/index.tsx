import { createFileRoute } from "@tanstack/react-router";
import KnowledgeList from "@/components/KnowledgeList";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Knowledge Nebula — Your AI Knowledge Universe" },
      { name: "description", content: "AI-powered personal knowledge base. Upload documents, search by meaning, and chat with your knowledge." },
    ],
  }),
});

function Index() {
  return (
    <div className="nebula-bg min-h-screen">
      <KnowledgeList />
    </div>
  );
}
