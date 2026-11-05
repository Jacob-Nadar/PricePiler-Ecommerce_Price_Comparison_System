import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { compareProduct, getOfferHistory, getPriceHistory, getProduct } from '../services/api';
import PriceChart from '../components/PriceChart';
import { PriceSignal } from '../components/ProductCard';
import { PriceAlertButton, StockAlertButton } from '../components/AlertControls';
import Icon from '../components/Icon';
import { AvailabilityBadge, EmptyState, ProductImage, RatingStars, SaveButton, StoreBadge } from '../components/ui';
import { DetailsSkeleton } from '../components/Skeleton';
import { useApp } from '../context/AppContext';
import { formatPriceINR, shortStoreName, specsList, timeAgo } from '../utils/formatters';

export default function ProductDetails() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast, updateSaved, watchlist } = useApp();
  const name = searchParams.get('name') || searchParams.get('q') || '';
  const brand = searchParams.get('brand') || '';
  const stateProduct = location.state?.product;
  const isStored = /^\d+$/.test(String(id));

  const [product, setProduct] = useState(stateProduct || null);
  const [series, setSeries] = useState([]);
  const [range, setRange] = useState('all');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(!stateProduct);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef(null);

  const fetchLive = useCallback(
    async ({ fresh = false, signal } = {}) => {
      const res = await compareProduct({ name, brand, specifications: {} }, { signal, fresh });
      const match = res.data.results?.[0];
      if (!match) throw new Error('This product is not currently listed at any supported store.');
      return match;
    },
    [name, brand]
  );

  useEffect(() => {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    const load = async () => {
      setError('');
      try {
        if (!isStored) {
          let match = stateProduct;
          if (!match) {
            if (!name) throw new Error('No product was selected.');
            setLoading(true);
            match = await fetchLive({ signal: ctrl.signal });
          }
          if (ctrl.signal.aborted) return;
          setProduct(match);
          setLoading(false);
          return;
        }
        setLoading(true);
        const res = await getProduct(id);
        if (ctrl.signal.aborted) return;
        setProduct(res.data);
        setLoading(false);
      } catch (err) {
        if (err.cancelled || ctrl.signal.aborted) return;
        setError(err.message);
        setLoading(false);
      }
    };
    load();
    return () => ctrl.abort();
    // stateProduct is read once on navigation; re-running on its identity would refetch needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, name, brand]);

  // Price history for every retailer listing of this product, in the chosen range.
  const offerKey = (product?.offers || []).map((o) => o.productUrl).join('|');
  useEffect(() => {
    if (!product) return undefined;
    const ctrl = new AbortController();
    setHistoryLoading(true);
    const request = isStored
      ? getPriceHistory(id, range)
      : getOfferHistory(product.offers.slice(0, 12), { signal: ctrl.signal, range });
    request
      .then((res) => !ctrl.signal.aborted && setSeries(res.data.history || []))
      .catch(() => {
        /* history is optional; the page still shows live offers */
      })
      .finally(() => !ctrl.signal.aborted && setHistoryLoading(false));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerKey, range, isStored, id]);

  const refresh = async () => {
    if (!name && !product?.name) return;
    setRefreshing(true);
    try {
      const res = await compareProduct(
        { name: name || product.name, brand: brand || product.brand || '', specifications: {} },
        { fresh: true }
      );
      const match = res.data.results?.[0];
      if (!match) throw new Error('No store lists this product right now.');
      setProduct(match);
      const saved = watchlist.find((item) => item.name === match.name);
      if (saved && match.bestOffer) {
        updateSaved(saved.id, { lastPrice: match.bestOffer.price, lastStore: match.bestOffer.storeName, lastCheckedAt: new Date().toISOString() });
      }
      toast('Live prices updated');
    } catch (err) {
      toast(err.message, { type: 'error' });
    } finally {
      setRefreshing(false);
    }
  };

  const share = async () => {
    const url = `${window.location.origin}/product/live?${new URLSearchParams({ name: product.name, ...(product.brand ? { brand: product.brand } : {}) })}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: product.name, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast('Link copied to clipboard');
    } catch {
      /* share sheet dismissed */
    }
  };

  const offers = useMemo(() => product?.offers || [], [product]);
  const lastChecked = offers.reduce((latest, o) => (o.lastChecked && (!latest || o.lastChecked > latest) ? o.lastChecked : latest), null);

  if (loading) return <DetailsSkeleton />;

  if (error || !product) {
    return (
      <div className="container-page max-w-3xl py-12">
        <EmptyState
          icon="alert"
          title="We couldn’t load this product"
          action={
            <div className="flex gap-2">
              <button type="button" onClick={() => navigate(-1)} className="btn-secondary">
                Go back
              </button>
              {name && (
                <Link to={`/search?q=${encodeURIComponent(name)}`} className="btn-primary">
                  Search instead
                </Link>
              )}
            </div>
          }
        >
          {error || 'Product not found.'}
        </EmptyState>
      </div>
    );
  }

  const { bestOffer, hasInStock, noInStockReason, savings } = product;
  const specs = specsList(product.specifications);
  const storeCount = new Set(offers.map((o) => o.storeSlug)).size;

  return (
    <div className="container-page max-w-6xl py-6 sm:py-8">
      <button
        type="button"
        onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/search'))}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
      >
        <Icon name="arrowLeft" className="h-4 w-4" />
        Back to results
      </button>

      <div className="card animate-slide-up overflow-hidden">
        <div className="grid gap-6 p-5 sm:p-7 md:grid-cols-[minmax(0,320px)_1fr] md:gap-10">
          <div className="relative flex aspect-square items-center justify-center rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800">
            <ProductImage src={product.imageUrl} alt={product.name} className="h-full w-full" />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {product.brand && (
                <span className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-brand-700 dark:text-brand-400">{product.brand}</span>
              )}
              {product.category && <span className="font-mono text-[11px] text-slate-400">· {product.category}</span>}
            </div>
            <h1 className="mt-2 font-sans text-xl font-semibold leading-snug text-slate-900 dark:text-white sm:text-2xl">{product.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <RatingStars rating={product.rating} count={product.ratingCount} />
              <span className="font-mono text-[11px] text-slate-400">
                {storeCount} store{storeCount === 1 ? '' : 's'} · {offers.length} listing{offers.length === 1 ? '' : 's'}
              </span>
            </div>

            {hasInStock && bestOffer ? (
              <div className="mt-5 rounded-xl border border-brand-300/50 bg-brand-50/60 p-5 dark:border-brand-500/25 dark:bg-brand-500/[0.06]">
                <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-800 dark:text-brand-300">
                  <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.5} />
                  Best in-stock price
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="num text-4xl font-semibold tracking-tight text-slate-900 dark:text-white">{formatPriceINR(bestOffer.price)}</span>
                  {bestOffer.mrp && (
                    <span className="num text-sm text-slate-400 line-through">{formatPriceINR(bestOffer.mrp)}</span>
                  )}
                  {bestOffer.discountPercent > 0 && (
                    <span className="font-mono text-xs font-semibold text-brand-700 dark:text-brand-400">{bestOffer.discountPercent}% off</span>
                  )}
                </div>
                <div className="mt-1 text-[13px] text-slate-600 dark:text-slate-400">at {bestOffer.storeName}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {savings && (
                    <span className="badge bg-brand-500 py-1 text-slate-950">
                      You save {formatPriceINR(savings.amount)} ({savings.percent}%) vs {shortStoreName(savings.comparedTo)}
                    </span>
                  )}
                  <PriceSignal offer={bestOffer} />
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  <a href={bestOffer.productUrl} target="_blank" rel="noopener noreferrer" className="btn-deal px-6">
                    Buy on {shortStoreName(bestOffer.storeName)}
                    <Icon name="external" className="h-4 w-4" />
                  </a>
                  <SaveButton product={product} withLabel />
                  <PriceAlertButton product={product} />
                </div>
              </div>
            ) : (
              <div className="mt-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-semibold">{noInStockReason || 'No in-stock offer available right now.'}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <SaveButton product={product} withLabel />
                    <PriceAlertButton product={product} />
                  </div>
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button type="button" onClick={refresh} disabled={refreshing} className="btn-ghost px-3 py-2">
                <Icon name="refresh" className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Checking stores…' : 'Refresh prices'}
              </button>
              <button type="button" onClick={share} className="btn-ghost px-3 py-2">
                <Icon name="share" className="h-4 w-4" />
                Share
              </button>
              <span className="ml-auto flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-slate-400">
                <Icon name="clock" className="h-3.5 w-3.5" />
                Checked {timeAgo(lastChecked) || 'just now'}
              </span>
            </div>

            {specs.length > 0 && (
              <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {specs.map((s) => (
                  <div key={s.key} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/50">
                    <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">{s.label}</dt>
                    <dd className="mt-0.5 truncate text-[13px] font-medium text-slate-800 dark:text-slate-100" title={s.value}>{s.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="card animate-slide-up p-5 [animation-delay:60ms] sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Price history</h2>
            <span className="eyebrow">Recorded</span>
          </div>
          <PriceChart series={series} range={range} onRangeChange={setRange} loading={historyLoading} />
        </section>

        <section className="card animate-slide-up p-5 [animation-delay:120ms] sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">All offers</h2>
            <span className="eyebrow">{offers.length} listings</span>
          </div>
          <ul className="space-y-2.5">
            {offers.map((o, idx) => {
              const isBest = bestOffer && o.productUrl === bestOffer.productUrl;
              const isOut = o.availability === 'out_of_stock';
              return (
                <li
                  key={`${o.storeSlug}-${o.productUrl || idx}`}
                  className={`rounded-lg border p-3 transition-colors ${
                    isBest
                      ? 'border-brand-400/50 bg-brand-50/50 dark:border-brand-400/30 dark:bg-brand-500/5'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <StoreBadge slug={o.storeSlug} name={o.storeName} size="sm" />
                    <div className="text-right">
                      <div className={`num text-[15px] font-semibold ${isOut ? 'text-slate-400 line-through' : 'text-slate-900 dark:text-white'}`}>
                        {formatPriceINR(o.price)}
                      </div>
                      {o.discountPercent > 0 && (
                        <div className="font-mono text-[10px] text-slate-400">
                          <span className="line-through">{formatPriceINR(o.mrp)}</span>{' '}
                          <span className="text-brand-700 dark:text-brand-400">{o.discountPercent}% off</span>
                        </div>
                      )}
                    </div>
                  </div>
                  {o.title && o.title !== product.name && (
                    <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{o.title}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <AvailabilityBadge status={o.availability} />
                    {isBest && <span className="badge bg-brand-500 text-slate-950">Best</span>}
                    {isOut && <StockAlertButton product={product} offer={o} />}
                    {o.sponsored && <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800">Sponsored</span>}
                    <PriceSignal offer={o} />
                    {o.productUrl && (
                      <a
                        href={o.productUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                      >
                        Visit <Icon name="external" className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-xs text-slate-400">
            {product.note || 'Prices are listed product prices. Shipping, taxes, and other charges may differ across stores.'}
          </p>
        </section>
      </div>
    </div>
  );
}
