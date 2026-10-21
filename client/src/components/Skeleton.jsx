export function ProductCardSkeleton() {
  return (
    <div className="card p-5">
      <div className="flex gap-4">
        <div className="skeleton h-28 w-28 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-3 pt-1">
          <div className="skeleton h-4 w-3/4" />
          <div className="skeleton h-3 w-1/3" />
          <div className="flex gap-2">
            <div className="skeleton h-5 w-16 rounded-full" />
            <div className="skeleton h-5 w-20 rounded-full" />
          </div>
          <div className="skeleton h-7 w-32" />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-20 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export function OfferSkeleton() {
  return (
    <div className="card space-y-3 p-5">
      <div className="skeleton h-4 w-1/3" />
      <div className="skeleton h-6 w-1/4" />
      <div className="skeleton h-3 w-1/2" />
    </div>
  );
}

export function DetailsSkeleton() {
  return (
    <div className="container-page max-w-6xl space-y-6 py-8">
      <div className="skeleton h-4 w-32" />
      <div className="card grid gap-8 p-6 md:grid-cols-[320px_1fr]">
        <div className="skeleton aspect-square rounded-2xl" />
        <div className="space-y-4">
          <div className="skeleton h-7 w-4/5" />
          <div className="skeleton h-4 w-1/3" />
          <div className="skeleton h-24 w-full rounded-2xl" />
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-14 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
      <OfferSkeleton />
      <OfferSkeleton />
    </div>
  );
}

export default ProductCardSkeleton;
