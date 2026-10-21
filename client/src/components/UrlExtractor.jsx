import { useEffect, useRef, useState } from 'react';
import { extractUrl } from '../services/api';
import Icon from './Icon';
import { AvailabilityBadge, ProductImage, RatingStars, Spinner, StoreBadge } from './ui';
import { formatPriceINR } from '../utils/formatters';

export default function UrlExtractor({ onExtracted, initialUrl = '' }) {
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const controller = useRef(null);

  const extract = async (value) => {
    const target = String(value || '').trim();
    if (!target) return;
    controller.current?.abort();
    controller.current = new AbortController();
    setError('');
    setResult(null);
    setLoading(true);
    try {
      const res = await extractUrl(target, { signal: controller.current.signal });
      setResult(res.data);
    } catch (err) {
      if (!err.cancelled) setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // A link pasted into the main search box arrives here pre-filled; extract it right away.
  useEffect(() => {
    if (initialUrl) {
      setUrl(initialUrl);
      extract(initialUrl);
    }
    return () => controller.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  const handleConfirm = () => {
    if (!result) return;
    onExtracted({
      name: result.name,
      brand: result.brand,
      model: result.model,
      category: result.category,
      imageUrl: result.imageUrl,
      specifications: result.specifications || {},
    });
  };

  const unverified = result && (result.price == null || result.availability === 'unknown');

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          extract(url);
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <div className="relative flex-1">
          <Icon name="link" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            className="input h-14 rounded-2xl pl-12 text-base"
            placeholder="Paste a product link from Amazon.in, Flipkart or Myntra"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text').trim();
              if (/^https?:\/\//i.test(pasted)) {
                e.preventDefault();
                setUrl(pasted);
                extract(pasted);
              }
            }}
            aria-label="Product URL"
            inputMode="url"
          />
        </div>
        <button type="submit" className="btn-primary h-14 rounded-2xl px-7 text-base" disabled={loading || !url.trim()}>
          {loading ? <Spinner /> : <Icon name="sparkles" className="h-4 w-4" />}
          {loading ? 'Reading link…' : 'Get details'}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        Works with
        <StoreBadge slug="amazon_in" size="sm" name="Amazon.in" />
        <StoreBadge slug="flipkart" size="sm" />
        <StoreBadge slug="myntra" size="sm" />
      </div>

      {error && (
        <div className="mt-4 flex animate-slide-up items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {result && (
        <div className="mt-5 animate-slide-up rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-800/50">
          <div className="flex gap-4">
            <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700">
              <ProductImage src={result.imageUrl} alt={result.name} className="h-full w-full" />
            </div>
            <div className="min-w-0 flex-1">
              <StoreBadge slug={result.storeSlug} size="sm" />
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-display text-2xl font-bold text-slate-900 dark:text-white">
                  {formatPriceINR(result.price)}
                </span>
                {result.mrp && (
                  <span className="text-sm text-slate-400 line-through">{formatPriceINR(result.mrp)}</span>
                )}
                <AvailabilityBadge status={result.availability} />
              </div>
              <div className="mt-1.5">
                <RatingStars rating={result.rating} count={result.ratingCount} compact />
              </div>
              {result.sourceNote && (
                <p className={`mt-2 text-xs ${unverified ? 'text-amber-700 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}>
                  {result.sourceNote}
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <label className="label" htmlFor="ux-name">Product name</label>
              <input
                id="ux-name"
                className="input"
                value={result.name}
                onChange={(e) => setResult({ ...result, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="ux-brand">Brand</label>
                <input
                  id="ux-brand"
                  className="input"
                  value={result.brand || ''}
                  onChange={(e) => setResult({ ...result, brand: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="ux-model">Model</label>
                <input
                  id="ux-model"
                  className="input"
                  value={result.model || ''}
                  onChange={(e) => setResult({ ...result, model: e.target.value })}
                />
              </div>
            </div>
          </div>

          <button type="button" onClick={handleConfirm} className="btn-primary mt-4 w-full" disabled={!result.name?.trim()}>
            Compare across all stores
            <Icon name="arrowRight" className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
