import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { searchProducts, searchProductsAdvanced } from '../services/api';
import ProductCard from '../components/ProductCard';
import Filters, { SORT_OPTIONS } from '../components/Filters';
import { ProductCardSkeleton } from '../components/Skeleton';
import Icon from '../components/Icon';
import { EmptyState, Spinner, StoreBadge } from '../components/ui';
import { useApp } from '../context/AppContext';
import { STORES } from '../utils/formatters';

const LOADING_STEPS = [
  'Checking Amazon India…',
  'Checking Flipkart…',
  'Checking Myntra…',
  'Matching identical products across stores…',
  'Finding the best in-stock price…',
];

// Recalculate best price and savings for the offers that survive the filters.
function withOffers(product, offers) {
  const inStock = offers.filter((o) => o.availability === 'in_stock' && o.price != null);
  const bestOffer = inStock.length ? inStock.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  let savings = null;
  if (bestOffer) {
    const others = inStock.filter((o) => o.storeSlug !== bestOffer.storeSlug);
    if (others.length) {
      const highest = others.reduce((a, b) => (b.price > a.price ? b : a));
      const amount = Math.round((highest.price - bestOffer.price) * 100) / 100;
      if (amount > 0) savings = { amount, percent: Math.round((amount / highest.price) * 100), comparedTo: highest.storeName };
    }
  }
  const allOut = offers.length > 0 && offers.every((o) => o.availability === 'out_of_stock');
  return {
    ...product,
    allOffers: product.offers,
    offers,
    bestOffer,
    hasInStock: Boolean(bestOffer),
    savings,
    noInStockReason: bestOffer
      ? null
      : allOut
        ? 'Out of stock at every matched store.'
        : product.noInStockReason || 'No confirmed in-stock offer matches your filters.',
  };
}

function StoreStatusBar({ storeStatus, loading, elapsed }) {
  if (loading) {
    return (
      <div className="card mb-5 overflow-hidden">
        <div className="relative h-1 overflow-hidden bg-brand-100 dark:bg-brand-500/10">
          <div className="absolute inset-y-0 w-2/5 animate-progress-indeterminate rounded-full bg-brand-500" />
        </div>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
          <Spinner className="h-4 w-4 text-brand-600" />
          <span key={Math.min(Math.floor(elapsed / 2), LOADING_STEPS.length - 1)} className="animate-fade-in font-medium">
            {LOADING_STEPS[Math.min(Math.floor(elapsed / 2), LOADING_STEPS.length - 1)]}
          </span>
          <span className="ml-auto text-xs tabular-nums text-slate-400">{elapsed}s</span>
        </div>
      </div>
    );
  }
  if (!storeStatus.length) return null;
  return (
    <div className="scrollbar-none -mx-4 mb-5 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
      {storeStatus.map((s) => {
        const tone =
          s.status === 'matched'
            ? 'border-deal-500/30 bg-deal-50 dark:bg-deal-500/10'
            : s.status === 'unavailable'
              ? 'border-amber-300/60 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10'
              : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900';
        const label = s.status === 'matched' ? 'Results found' : s.status === 'unavailable' ? 'Temporarily busy' : 'No match';
        return (
          <span
            key={s.storeSlug}
            title={s.message || undefined}
            className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-xs ${tone}`}
          >
            <StoreBadge slug={s.storeSlug} name={STORES[s.storeSlug]?.short || s.storeName} size="sm" />
            <span className="text-slate-500 dark:text-slate-400">{label}</span>
          </span>
        );
      })}
    </div>
  );
}

export default function SearchResults() {
  const [searchParams] = useSearchParams();
  const { addRecentSearch, toast } = useApp();
  const q = searchParams.get('q') || '';
  const brand = searchParams.get('brand') || '';
  const model = searchParams.get('model') || '';
  const category = searchParams.get('category') || '';
  const fromLink = searchParams.get('from') === 'link';
  const specificationKey = [...searchParams.entries()]
    .filter(([key]) => key.startsWith('spec_'))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const specifications = useMemo(
    () =>
      Object.fromEntries(
        [...searchParams.entries()]
          .filter(([key, value]) => key.startsWith('spec_') && value)
          .map(([key, value]) => [key.slice(5), value])
      ),
    // specificationKey captures exactly the spec_ params, so it is the right dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [specificationKey]
  );
  const isAdvanced = Boolean(brand || model || specificationKey);
  const hasQuery = Boolean(q || category);

  const [results, setResults] = useState([]);
  const [storeStatus, setStoreStatus] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const controller = useRef(null);

  const [availability, setAvailability] = useState('all');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [sort, setSort] = useState('relevance');
  const [selectedStores, setSelectedStores] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const resetFilters = useCallback(() => {
    setAvailability('all');
    setMinPrice('');
    setMaxPrice('');
    setMinRating(0);
    setSelectedStores([]);
  }, []);

  const fetchResults = useCallback(
    async ({ fresh = false } = {}) => {
      controller.current?.abort();
      if (!hasQuery) {
        setResults([]);
        setStoreStatus([]);
        setLoading(false);
        return;
      }
      const ctrl = new AbortController();
      controller.current = ctrl;
      fresh ? setRefreshing(true) : setLoading(true);
      setError('');
      try {
        const res = isAdvanced
          ? await searchProductsAdvanced({ name: q, brand, model, category, specifications }, { signal: ctrl.signal, fresh })
          : await searchProducts(q, category, { signal: ctrl.signal, fresh });
        if (ctrl.signal.aborted) return;
        setResults(res.data.results || []);
        setStoreStatus(res.data.storeStatus || []);
        if (fresh) toast('Prices refreshed from every store');
      } catch (err) {
        if (err.cancelled || ctrl.signal.aborted) return;
        setError(err.message);
        if (!fresh) {
          setResults([]);
          setStoreStatus([]);
        }
      } finally {
        if (controller.current === ctrl) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [hasQuery, isAdvanced, q, brand, model, category, specifications, toast]
  );

  // New search: reset filters, record it, fetch. Previous in-flight requests are aborted.
  useEffect(() => {
    resetFilters();
    setSort('relevance');
    if (q) addRecentSearch(q);
    fetchResults();
    return () => controller.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, brand, model, category, specificationKey]);

  useEffect(() => {
    if (!loading) return undefined;
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    document.body.style.overflow = filtersOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [filtersOpen]);

  const storeOptions = useMemo(() => {
    const counts = new Map();
    results.forEach((r) => new Set(r.offers.map((o) => o.storeSlug)).forEach((slug) => counts.set(slug, (counts.get(slug) || 0) + 1)));
    return [...counts.entries()].map(([slug, count]) => ({ slug, name: STORES[slug]?.name || slug, count }));
  }, [results]);

  const toggleStore = (slug) =>
    setSelectedStores((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));

  const activeFilterCount =
    (availability !== 'all') + Boolean(minPrice) + Boolean(maxPrice) + (minRating > 0) + (selectedStores.length > 0);

  const filtered = useMemo(() => {
    const min = minPrice === '' ? null : Number(minPrice);
    const max = maxPrice === '' ? null : Number(maxPrice);
    let list = results
      .filter((r) => !minRating || (r.rating ?? 0) >= minRating)
      .map((r) => {
        const offers = r.offers.filter(
          (o) =>
            (availability === 'all' || o.availability === availability) &&
            (selectedStores.length === 0 || selectedStores.includes(o.storeSlug)) &&
            (min == null || (o.price != null && o.price >= min)) &&
            (max == null || (o.price != null && o.price <= max))
        );
        return activeFilterCount ? withOffers(r, offers) : r;
      })
      .filter((r) => r.offers.length > 0);

    const price = (r) => r.bestOffer?.price ?? Math.min(...r.offers.map((o) => o.price ?? Infinity));
    const sorters = {
      price_asc: (a, b) => price(a) - price(b),
      price_desc: (a, b) => (price(b) === Infinity ? -1 : price(b)) - (price(a) === Infinity ? -1 : price(a)),
      savings: (a, b) => (b.savings?.amount ?? 0) - (a.savings?.amount ?? 0),
      discount: (a, b) =>
        Math.max(0, ...b.offers.map((o) => o.discountPercent ?? 0)) - Math.max(0, ...a.offers.map((o) => o.discountPercent ?? 0)),
      rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.ratingCount ?? 0) - (a.ratingCount ?? 0),
    };
    if (sorters[sort]) list = [...list].sort(sorters[sort]);
    return list;
  }, [results, availability, minPrice, maxPrice, minRating, sort, selectedStores, activeFilterCount]);

  const unavailableStores = storeStatus.filter((s) => s.status === 'unavailable');
  const multiStore = filtered.filter((r) => new Set(r.offers.map((o) => o.storeSlug)).size > 1).length;

  const title = q
    ? fromLink
      ? 'Comparing your product'
      : `Results for “${q}”`
    : category
      ? category
      : 'Search products';

  const filtersPanel = (
    <Filters
      availability={availability}
      setAvailability={setAvailability}
      minPrice={minPrice}
      setMinPrice={setMinPrice}
      maxPrice={maxPrice}
      setMaxPrice={setMaxPrice}
      minRating={minRating}
      setMinRating={setMinRating}
      stores={storeOptions}
      selectedStores={selectedStores}
      toggleStore={toggleStore}
      activeCount={activeFilterCount}
      onReset={resetFilters}
      onClose={() => setFiltersOpen(false)}
    />
  );

  return (
    <div className="container-page py-6 sm:py-8">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <nav className="mb-1 flex items-center gap-1 text-xs text-slate-400">
            <Link to="/" className="hover:text-brand-600">Home</Link>
            <Icon name="chevronRight" className="h-3 w-3" />
            <span>{category && !q ? 'Category' : 'Search'}</span>
          </nav>
          <h1 className="truncate text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">{title}</h1>
          {fromLink && q && <p className="mt-1 line-clamp-1 text-sm text-slate-500 dark:text-slate-400">{q}</p>}
          {!loading && hasQuery && (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {filtered.length} product{filtered.length === 1 ? '' : 's'}
              {multiStore > 0 && ` · ${multiStore} available at more than one store`}
              {isAdvanced && !fromLink && ` · exact match for ${[brand, model || q].filter(Boolean).join(' ')}`}
            </p>
          )}
        </div>
        {hasQuery && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => fetchResults({ fresh: true })}
              disabled={loading || refreshing}
              className="btn-secondary"
              title="Fetch the latest prices from every store"
              aria-label="Refresh prices"
            >
              <Icon name="refresh" className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{refreshing ? 'Refreshing…' : 'Refresh prices'}</span>
            </button>
            <label className="relative">
              <span className="sr-only">Sort by</span>
              <select className="input appearance-none pr-9 font-medium" value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <Icon name="chevronDown" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </label>
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="btn-secondary relative lg:hidden"
              aria-label={`Open filters${activeFilterCount ? ` (${activeFilterCount} active)` : ''}`}
            >
              <Icon name="sliders" className="h-4 w-4" />
              {activeFilterCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>
        )}
      </div>

      {hasQuery && <StoreStatusBar storeStatus={storeStatus} loading={loading} elapsed={elapsed} />}

      {error && (
        <div className="mb-5 flex animate-slide-up flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          <span className="flex items-center gap-2">
            <Icon name="alert" className="h-4 w-4 shrink-0" />
            {error}
          </span>
          <button type="button" onClick={() => fetchResults()} className="btn-secondary py-1.5">
            Try again
          </button>
        </div>
      )}

      {!loading && unavailableStores.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <span className="flex items-start gap-2">
            <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{unavailableStores.map((s) => s.message).filter(Boolean).join(' ')}</span>
          </span>
          <button type="button" onClick={() => fetchResults({ fresh: true })} disabled={refreshing} className="btn-secondary py-1.5">
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[264px_1fr]">
        {hasQuery && <aside className="hidden self-start lg:sticky lg:top-20 lg:block">{filtersPanel}</aside>}

        <section className={`${hasQuery ? '' : 'lg:col-span-2'} min-w-0 ${refreshing ? 'opacity-60 transition-opacity' : ''}`} aria-busy={loading}>
          {loading ? (
            <div className="space-y-4">
              {[0, 1, 2].map((i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </div>
          ) : !hasQuery ? (
            <EmptyState icon="search" title="What are you shopping for?" action={<Link to="/" className="btn-primary">Start a search</Link>}>
              Search any product or pick a category to compare live prices across stores.
            </EmptyState>
          ) : filtered.length === 0 && results.length > 0 ? (
            <EmptyState
              icon="sliders"
              title="No products match your filters"
              action={
                <button type="button" onClick={resetFilters} className="btn-primary">
                  Clear filters
                </button>
              }
            >
              Try widening the price range or including more stores.
            </EmptyState>
          ) : filtered.length === 0 && !error ? (
            <EmptyState
              icon={unavailableStores.length ? 'alert' : 'search'}
              title={unavailableStores.length ? 'Could not confirm a match right now' : 'No matching product found'}
            >
              {unavailableStores.length
                ? 'A store was temporarily unavailable, so there is not enough live data to confirm this product. Try again in a minute.'
                : isAdvanced
                  ? 'No store lists this exact product right now. Try removing the model or brand to see similar items.'
                  : 'Try a more specific name — for example “boAt Airdopes 141”, “basmati rice 5kg” or “Nike running shoes”.'}
            </EmptyState>
          ) : (
            <div className="space-y-4">
              {filtered.map((product, idx) => (
                <ProductCard key={`${product.name}-${product.offers[0]?.productUrl || idx}`} product={product} index={idx} />
              ))}
            </div>
          )}
        </section>
      </div>

      {filtersOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <div className="absolute inset-0 animate-fade-in bg-slate-900/40 backdrop-blur-sm" onClick={() => setFiltersOpen(false)} />
          <div className="absolute inset-y-0 right-0 w-full max-w-sm animate-slide-in-right overflow-y-auto bg-slate-50 p-4 dark:bg-slate-950">
            {filtersPanel}
            <button type="button" onClick={() => setFiltersOpen(false)} className="btn-primary mt-4 w-full">
              Show {filtered.length} product{filtered.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
