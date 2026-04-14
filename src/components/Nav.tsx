import { useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import NotificationBell from "@/components/NotificationBell";
import { Menu, X } from "lucide-react";

const links = [
  { href: "/", label: "Knowledge" },
  { href: "/upload", label: "Upload" },
  { href: "/sources", label: "Sources" },
  { href: "/search", label: "Search" },
  { href: "/chat", label: "Chat" },
];

export default function Nav() {
  const location = useLocation();
  const [open, setOpen] = useState(false);

  return (
    <header className="border-b border-border glass sticky top-0 z-50">
      <div className="container mx-auto px-4 max-w-6xl flex items-center justify-between h-14">
        <Link to="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
          <span className="text-xl">🌌</span>
          <span className="font-display font-semibold gradient-text text-lg">
            Knowledge Nebula
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
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

        {/* Mobile controls */}
        <div className="flex md:hidden items-center gap-1">
          <NotificationBell />
          <button
            onClick={() => setOpen(!open)}
            className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Toggle menu"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <nav className="md:hidden border-t border-border glass px-4 pb-3 pt-2 flex flex-col gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              to={l.href}
              onClick={() => setOpen(false)}
              className={cn(
                "px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                location.pathname === l.href
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
