import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export const SOURCE_ICONS: Record<string, string> = {
  pdf: "📄",
  text: "📝",
  markdown: "📋",
  docx: "📘",
  url: "🔗",
  note: "✏️",
};

export const SOURCE_COLORS: Record<string, string> = {
  pdf: "bg-destructive/20 text-destructive border-destructive/30",
  text: "bg-muted text-muted-foreground border-border",
  markdown: "bg-nebula-blue/20 text-nebula-blue border-nebula-blue/30",
  docx: "bg-primary/20 text-primary border-primary/30",
  url: "bg-chart-5/20 text-chart-5 border-chart-5/30",
  note: "bg-chart-4/20 text-chart-4 border-chart-4/30",
};
