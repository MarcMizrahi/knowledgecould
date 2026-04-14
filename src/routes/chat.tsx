import { createFileRoute } from "@tanstack/react-router";
import ChatPanel from "@/components/ChatPanel";

export const Route = createFileRoute("/chat")({
  component: ChatPage,
  head: () => ({
    meta: [
      { title: "Chat — Knowledge Nebula" },
      { name: "description", content: "Chat with your knowledge base using AI-powered question answering." },
    ],
  }),
});

function ChatPage() {
  return <ChatPanel />;
}
