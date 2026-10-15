import { BrainCircuit } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder rows for a sidebar list, varied in width so they read as text */
function ListSkeleton({ widths }: { widths: string[] }) {
  return (
    <ul className="grid gap-1 px-2">
      {widths.map((width, i) => (
        <li key={i} className="flex items-center gap-2 py-1.5">
          <Skeleton className="size-4 shrink-0 rounded" />
          <Skeleton className={`h-3.5 ${width}`} />
        </li>
      ))}
    </ul>
  );
}

function SectionSkeleton({ label, widths }: { label: string; widths: string[] }) {
  return (
    <section className="grid gap-1">
      <h2 className="pl-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</h2>
      <ListSkeleton widths={widths} />
    </section>
  );
}

/**
 * The app's frame while the sidebar's documents and chats load: the same
 * three layouts as AppShell (full sidebar, rail, top bar), with skeleton
 * rows for the lists, so nothing jumps when the real thing arrives.
 */
export function AppShellSkeleton() {
  return (
    <div className="flex h-dvh overflow-hidden" aria-busy="true">
      <span role="status" className="sr-only">
        Loading…
      </span>
      <aside className="hidden w-70 shrink-0 flex-col gap-4 border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-14 items-center gap-2 px-4">
          <BrainCircuit className="size-5 text-sidebar-primary" />
          <span className="font-semibold tracking-tight">DocuMind</span>
        </div>
        <SectionSkeleton label="Documents" widths={["w-40", "w-32", "w-44"]} />
        <SectionSkeleton label="Chats" widths={["w-44", "w-36", "w-40", "w-28"]} />
      </aside>
      <aside className="hidden w-16 shrink-0 flex-col items-center gap-3 border-r border-sidebar-border bg-sidebar py-4 md:flex lg:hidden">
        <BrainCircuit className="mb-2 size-5 text-sidebar-primary" />
        <Skeleton className="size-8 rounded-md" />
        <Skeleton className="size-8 rounded-md" />
        <Skeleton className="size-8 rounded-md" />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 md:hidden">
          <BrainCircuit className="size-5 text-sidebar-primary" />
          <span className="font-semibold tracking-tight">DocuMind</span>
        </header>
        <PageSkeleton />
      </div>
    </div>
  );
}

/** A page's heading and a few blocks of content, for pages that are still loading */
export function PageSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10" aria-hidden>
      <div className="grid gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <Skeleton className="h-40 w-full rounded-xl" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
    </div>
  );
}
