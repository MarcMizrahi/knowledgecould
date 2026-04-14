import { createFileRoute } from "@tanstack/react-router";
import SearchPanel from "@/components/SearchPanel";

export const Route = createFileRoute("/search")({
  component: SearchPage,
  head: () => ({
    meta: [
      { title: "Search — Knowledge Nebula" },
      { name: "description", content: "Search your knowledge base by meaning with semantic search." },
    ],
  }),
});

function SearchPage() {
  return <SearchPanel />;
}
