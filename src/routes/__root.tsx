import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import Nav from "@/components/Nav";
import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center nebula-bg px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold gradient-text font-display">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground font-display">
          Lost in the nebula
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has drifted away.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Return to nebula
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Knowledge Nebula" },
      { name: "description", content: "AI-powered personal knowledge universe" },
      { property: "og:title", content: "Knowledge Nebula" },
      { name: "twitter:title", content: "Knowledge Nebula" },
      { property: "og:description", content: "AI-powered personal knowledge universe" },
      { name: "twitter:description", content: "AI-powered personal knowledge universe" },
      { name: "twitter:card", content: "summary" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <HeadContent />
      </head>
      <body className="nebula-bg min-h-screen">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <>
      <Nav />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
        <Outlet />
      </main>
    </>
  );
}
