import { Skeleton } from "@/components/ui/skeleton";

/** A document page while it loads: its header, then a list of passages */
export default function DocumentLoading() {
  return (
    <div className="flex-1 overflow-y-auto" aria-busy="true">
      <span role="status" className="sr-only">
        Loading document…
      </span>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10" aria-hidden>
        <div className="grid gap-3">
          <Skeleton className="h-7 w-64 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
        <div className="grid gap-3">
          {["h-24", "h-20", "h-28", "h-20"].map((height, i) => (
            <Skeleton key={i} className={`${height} w-full rounded-xl`} />
          ))}
        </div>
      </div>
    </div>
  );
}
