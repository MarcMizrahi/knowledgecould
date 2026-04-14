import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import NotificationBell from "@/components/NotificationBell";

const links = [
  { href: "/", label: "Knowledge" },
  { href: "/upload", label: "Upload" },
  { href: "/sources", label: "Sources" },
  { href: "/search", label: "Search" },
  { href: "/chat", label: "Chat" },
];

export default function Nav() {
  const location = useLocation();

  return (
    <header className="border-b border-border glass sticky top-0 z-50">
      <div className="container mx-auto px-4 max-w-6xl flex items-center justify-between h-14">
        <Link to="/" className="flex items-center gap-2">
          <span className="text-xl">🌌</span>
          <span className="font-display font-semibold gradient-text text-lg">
            Knowledge Nebula
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              to={l.href}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                location.pathname === l.href
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              {l.label}
            </Link>
          ))}
          <NotificationBell />
        </nav>
      </div>
    </header>
  );
}
