export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-bg-tertiary ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-l-[3px] border-border bg-bg-secondary p-4">
      {/* Header: icon + favicon + title */}
      <div className="flex items-start gap-2.5 mb-1">
        <Skeleton className="w-3.5 h-3.5 mt-0.5 rounded-sm shrink-0" />
        <Skeleton className="w-4 h-4 mt-0.5 rounded-sm shrink-0" />
        <Skeleton className="h-5 w-3/4 flex-1" />
      </div>
      {/* Meta line */}
      <div className="ml-[34px] mb-2">
        <Skeleton className="h-3 w-1/3" />
      </div>
      {/* Summary lines */}
      <div className="space-y-1.5 mb-3">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      {/* Tags (pill style) */}
      <div className="flex gap-1.5 mb-3">
        <Skeleton className="h-6 w-14 rounded-full" />
        <Skeleton className="h-6 w-18 rounded-full" />
        <Skeleton className="h-6 w-12 rounded-full" />
      </div>
    </div>
  );
}
