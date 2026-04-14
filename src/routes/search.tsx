import { createFileRoute } from "@tanstack/react-router";
import SearchPanel from "@/components/SearchPanel";

type SearchParams = {
  q?: string;
};

export const Route = createFileRoute("/search")({
  component: SearchPage,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Search — Knowledge Nebula" },
      { name: "description", content: "Search your knowledge base by meaning with semantic search." },
    ],
  }),
});

function SearchPage() {
  const { q } = Route.useSearch();
  return <SearchPanel initialQuery={q} />;
}
