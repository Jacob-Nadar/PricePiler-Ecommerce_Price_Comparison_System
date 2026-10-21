import { useState } from 'react';
import { Link } from 'react-router-dom';
import { compareProduct } from '../services/api';
import Icon from '../components/Icon';
import { PriceAlertButton } from '../components/AlertControls';
import { EmptyState, ProductImage, Spinner } from '../components/ui';
import { useApp } from '../context/AppContext';
import { formatPriceINR, shortStoreName, timeAgo } from '../utils/formatters';

function detailsLink(item) {
  return `/product/live?${new URLSearchParams({ name: item.name, ...(item.brand ? { brand: item.brand } : {}) })}`;
}

export default function Watchlist() {
  const { watchlist, updateSaved, removeSaved, toast } = useApp();
  const [checking, setChecking] = useState(null); // id currently being checked
  const [progress, setProgress] = useState(0);

  const checkItem = async (item) => {
    const res = await compareProduct({ name: item.name, brand: item.brand || '', specifications: {} }, { fresh: true });
    const best = res.data.results?.[0]?.bestOffer;
    const changes = { lastCheckedAt: new Date().toISOString() };
    if (best) {
      Object.assign(changes, { lastPrice: best.price, lastStore: best.storeName, lastUrl: best.productUrl });
    }
    updateSaved(item.id, changes);
    return { item, best };
  };

  const checkAll = async () => {
    let drops = 0;
    setProgress(0);
    for (const [i, item] of watchlist.entries()) {
      setChecking(item.id);
      try {
        const { best } = await checkItem(item);
        if (best && item.lastPrice != null && best.price < item.lastPrice) drops++;
      } catch {
        /* keep going; one failing product should not stop the rest */
      }
      setProgress(i + 1);
    }
    setChecking(null);
    toast(drops ? `${drops} price drop${drops === 1 ? '' : 's'} found` : 'Prices checked — no drops right now', {
      type: drops ? 'success' : 'info',
      duration: 4500,
    });
  };

  const checkOne = async (item) => {
    setChecking(item.id);
    try {
      const { best } = await checkItem(item);
      toast(best ? `Best price now ${formatPriceINR(best.price)} at ${best.storeName}` : 'Not in stock at any store right now', {
        type: best ? 'success' : 'info',
      });
    } catch (err) {
      toast(err.message, { type: 'error' });
    } finally {
      setChecking(null);
    }
  };

  if (watchlist.length === 0) {
    return (
      <div className="container-page max-w-3xl py-12">
        <EmptyState
          icon="heart"
          title="Your watchlist is empty"
          action={<Link to="/" className="btn-primary">Find products</Link>}
        >
          Tap the heart on any product to save it here and re-check every store in one click.{' '}
          <Link to="/register" className="font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300">
            Create an account
          </Link>{' '}
          to get automatic price tracking and email alerts.
        </EmptyState>
      </div>
    );
  }

  const busy = checking !== null;

  return (
    <div className="container-page max-w-5xl py-6 sm:py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">Watchlist</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {watchlist.length} saved product{watchlist.length === 1 ? '' : 's'} · stored on this device ·{' '}
            <Link to="/login?next=/dashboard" className="font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300">
              Log in to track automatically
            </Link>
          </p>
        </div>
        <button type="button" onClick={checkAll} disabled={busy} className="btn-primary">
          {busy ? <Spinner /> : <Icon name="refresh" className="h-4 w-4" />}
          {busy ? `Checking ${progress + 1} of ${watchlist.length}…` : 'Check latest prices'}
        </button>
      </div>

      <ul className="space-y-3">
        {watchlist.map((item, idx) => {
          const change = item.savedPrice != null && item.lastPrice != null ? item.lastPrice - item.savedPrice : 0;
          return (
            <li
              key={item.id}
              className={`card animate-slide-up p-4 transition-shadow hover:shadow-lift sm:p-5`}
              style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}
            >
              <div className="flex gap-4">
                <Link to={detailsLink(item)} className="h-20 w-20 shrink-0 rounded-xl border border-slate-100 bg-white p-2 dark:border-slate-800 sm:h-24 sm:w-24">
                  <ProductImage src={item.imageUrl} alt={item.name} className="h-full w-full" />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      to={detailsLink(item)}
                      className="line-clamp-2 font-semibold leading-snug text-slate-900 hover:text-brand-700 dark:text-white dark:hover:text-brand-300"
                    >
                      {item.name}
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        removeSaved(item.id);
                        toast('Removed from your watchlist', { type: 'info' });
                      }}
                      className="btn-icon -mr-2 -mt-1 h-8 w-8 shrink-0 hover:text-rose-500"
                      aria-label="Remove from watchlist"
                    >
                      <Icon name="trash" className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-display text-xl font-bold text-slate-900 dark:text-white">{formatPriceINR(item.lastPrice)}</span>
                    {item.lastStore && (
                      <span className="text-sm text-slate-500 dark:text-slate-400">at {shortStoreName(item.lastStore)}</span>
                    )}
                    {change < 0 && (
                      <span className="badge bg-deal-50 text-deal-700 dark:bg-deal-500/10 dark:text-deal-500">
                        <Icon name="trendingDown" className="h-3.5 w-3.5" /> {formatPriceINR(-change)} since saved
                      </span>
                    )}
                    {change > 0 && (
                      <span className="badge bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                        <Icon name="trendingUp" className="h-3.5 w-3.5" /> {formatPriceINR(change)} since saved
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <PriceAlertButton
                      product={{ ...item, offers: item.offers || [] }}
                      label="Get email price alerts"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300"
                    />
                    <button
                      type="button"
                      onClick={() => checkOne(item)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-50 dark:text-slate-400 dark:hover:text-white"
                    >
                      {checking === item.id ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="refresh" className="h-3.5 w-3.5" />}
                      Re-check
                    </button>
                    {item.lastUrl && (
                      <a
                        href={item.lastUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
                      >
                        Visit store <Icon name="external" className="h-3 w-3" />
                      </a>
                    )}
                    <span className="ml-auto text-xs text-slate-400">
                      Saved {timeAgo(item.savedAt)}
                      {item.savedPrice != null && ` at ${formatPriceINR(item.savedPrice)}`} · checked {timeAgo(item.lastCheckedAt)}
                    </span>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
