export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">…</span>
      <div className="h-12 w-2/3 max-w-md animate-pulse rounded-2xl bg-sunk motion-reduce:animate-none" />
      <div className="grid grid-cols-1 gap-5 min-[480px]:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3">
            <div className="aspect-[4/3] animate-pulse rounded-xl bg-sunk motion-reduce:animate-none" />
            <div className="h-5 w-3/4 animate-pulse rounded bg-sunk motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    </div>
  );
}
