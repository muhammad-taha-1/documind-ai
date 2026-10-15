import { Skeleton } from "@/components/ui/skeleton";

/** A chat while its messages load: the header, a few message shapes, and the input */
export default function ChatLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true">
      <span role="status" className="sr-only">
        Loading chat…
      </span>
      <header className="flex h-14 shrink-0 items-center border-b px-3">
        <Skeleton className="h-5 w-56 max-w-full" />
      </header>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 overflow-hidden px-4 py-6" aria-hidden>
        <Skeleton className="ml-auto h-10 w-2/3 rounded-2xl" />
        <div className="grid gap-2">
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
        <div className="grid gap-2">
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl px-4 pb-4" aria-hidden>
        <Skeleton className="h-14 w-full rounded-2xl" />
      </div>
    </div>
  );
}
