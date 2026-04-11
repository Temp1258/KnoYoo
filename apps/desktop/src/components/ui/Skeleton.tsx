export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-bg-tertiary ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-bg-secondary p-4">
      {/* Header: favicon + title + domain */}
      <div className="flex items-start gap-3 mb-2">
        <Skeleton className="w-4 h-4 mt-1 rounded-sm shrink-0" />
        <div className="flex-1 min-w-0">
          <Skeleton className="h-4 w-3/4 mb-1.5" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      {/* Summary lines */}
      <div className="space-y-1.5 mb-3">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      {/* Tags */}
      <div className="flex gap-1 mb-3">
        <Skeleton className="h-5 w-12 rounded-md" />
        <Skeleton className="h-5 w-16 rounded-md" />
        <Skeleton className="h-5 w-10 rounded-md" />
      </div>
      {/* Footer: date */}
      <Skeleton className="h-3 w-24" />
    </div>
  );
}
