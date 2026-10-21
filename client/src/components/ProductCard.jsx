import { Link } from 'react-router-dom';
import Icon from './Icon';
import { PriceAlertButton, StockAlertButton } from './AlertControls';
import { AvailabilityBadge, ProductImage, RatingStars, SaveButton, StoreBadge } from './ui';
import {
  bestOfferPerStore,
  detailsPath,
  formatPriceINR,
  shortStoreName,
  specsList,
  STORES,
  timeAgo,
} from '../utils/formatters';

export function PriceSignal({ offer }) {
  const history = offer?.priceHistory;
  if (!history || history.points < 1) return null;
  if (history.change < 0) {
    return (
      <span className="badge bg-deal-50 text-deal-700 dark:bg-deal-500/10 dark:text-deal-500">
        <Icon name="trendingDown" className="h-3.5 w-3.5" />
        {formatPriceINR(Math.abs(history.change))} lower than before
      </span>
    );
  }
  if (history.change > 0) {
    return (
      <span className="badge bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
        <Icon name="trendingUp" className="h-3.5 w-3.5" />
        Up {formatPriceINR(history.change)}
      </span>
    );
  }
  if (history.isLowest && history.points >= 3) {
    return (
      <span className="badge bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
        <Icon name="sparkles" className="h-3.5 w-3.5" />
        Lowest we’ve seen
      </span>
    );
  }
  return null;
}

function StoreTile({ product, slug, name, offer, status, isBest, hiddenByFilters }) {
  if (!offer) {
    const unavailable = status?.status === 'unavailable';
    return (
      <div className="flex min-h-[5.5rem] flex-col justify-between rounded-xl border border-dashed border-slate-200 p-3 dark:border-slate-700">
        <StoreBadge slug={slug} name={name} size="sm" />
        <p className={`text-xs ${unavailable ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'}`}>
          {unavailable ? 'Store busy — try refresh' : hiddenByFilters ? 'Hidden by your filters' : 'Not listed at this store'}
        </p>
      </div>
    );
  }
  const isOut = offer.availability === 'out_of_stock';
  return (
    <div
      className={`group/tile relative flex min-h-[5.5rem] flex-col rounded-xl border transition-all hover:-translate-y-0.5 hover:shadow-soft ${
        isBest
          ? 'border-deal-500/40 bg-deal-50/70 ring-1 ring-deal-500/20 dark:border-deal-500/30 dark:bg-deal-500/5'
          : isOut
            ? 'border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/40'
            : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600'
      }`}
    >
      {isBest && (
        <span className="absolute -top-2.5 right-3 rounded-full bg-deal-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
          Best price
        </span>
      )}
      <a
        href={offer.productUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex flex-1 flex-col justify-between gap-2 p-3 ${isOut ? 'opacity-75' : ''}`}
      >
        <div className="flex items-center justify-between gap-2">
          <StoreBadge slug={slug} name={STORES[slug]?.short || name} size="sm" />
          <Icon name="external" className="h-3.5 w-3.5 text-slate-300 transition-colors group-hover/tile:text-brand-500" />
        </div>
        <div className="flex items-end justify-between gap-2">
          <div>
            <div className={`font-display text-lg font-bold leading-none ${isOut ? 'text-slate-400 line-through' : 'text-slate-900 dark:text-white'}`}>
              {formatPriceINR(offer.price)}
            </div>
            {offer.discountPercent > 0 && !isOut && (
              <div className="mt-1 text-[11px] text-slate-400">
                <span className="line-through">{formatPriceINR(offer.mrp)}</span>{' '}
                <span className="font-semibold text-deal-600 dark:text-deal-500">{offer.discountPercent}% off</span>
              </div>
            )}
          </div>
          <AvailabilityBadge status={offer.availability} />
        </div>
      </a>
      {isOut && (
        <div className="px-3 pb-3">
          <StockAlertButton product={product} offer={offer} className="w-full justify-center" />
        </div>
      )}
    </div>
  );
}

export default function ProductCard({ product, index = 0 }) {
  const { offers, bestOffer, hasInStock, noInStockReason, savings } = product;
  const perStore = bestOfferPerStore(offers);
  // Stores that had a listing before the user's filters removed it.
  const hiddenStores = new Set((product.allOffers || []).map((o) => o.storeSlug).filter((slug) => !perStore.has(slug)));
  const statusFor = (slug) => product.storeStatus?.find((s) => s.storeSlug === slug);
  const storeSlugs = [...new Set([...Object.keys(STORES), ...perStore.keys()])];
  const specs = specsList(product.specifications).slice(0, 4);
  const lastChecked = offers.reduce((latest, o) => (o.lastChecked && (!latest || o.lastChecked > latest) ? o.lastChecked : latest), null);
  const sellerCount = perStore.size;
  const to = detailsPath(product);

  return (
    <article
      className="card group animate-slide-up overflow-hidden transition-shadow duration-300 hover:shadow-lift"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <div className="p-4 sm:p-5">
        <div className="flex gap-4">
          <Link
            to={to}
            state={{ product }}
            className="relative h-28 w-28 shrink-0 overflow-hidden rounded-xl border border-slate-100 bg-white p-2 dark:border-slate-800 sm:h-32 sm:w-32"
          >
            <ProductImage
              src={product.imageUrl}
              alt={product.name}
              className="h-full w-full transition-transform duration-500 group-hover:scale-105"
            />
          </Link>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <Link to={to} state={{ product }} className="min-w-0">
                <h3 className="line-clamp-2 font-sans text-[15px] font-semibold leading-snug text-slate-900 transition-colors hover:text-brand-700 dark:text-white dark:hover:text-brand-300 sm:text-base">
                  {product.name}
                </h3>
              </Link>
              <SaveButton product={product} className="-mr-2 -mt-1 shrink-0" />
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {product.brand && <span className="text-sm text-slate-500 dark:text-slate-400">{product.brand}</span>}
              <RatingStars rating={product.rating} count={product.ratingCount} compact />
              {sellerCount > 1 && (
                <span className="badge bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                  {sellerCount} stores
                </span>
              )}
            </div>

            {specs.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {specs.map((s) => (
                  <span key={s.key} className="badge bg-slate-100 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {s.value}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-3">
              {hasInStock && bestOffer ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">
                    {formatPriceINR(bestOffer.price)}
                  </span>
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    lowest at <span className="font-semibold text-slate-700 dark:text-slate-200">{bestOffer.storeName}</span>
                  </span>
                  {savings && (
                    <span className="badge bg-deal-600 text-white">
                      Save {formatPriceINR(savings.amount)} vs {shortStoreName(savings.comparedTo)}
                    </span>
                  )}
                  <PriceSignal offer={bestOffer} />
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                  <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
                  {noInStockReason || 'No confirmed in-stock offer is available.'}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {storeSlugs.map((slug) => {
            const offer = perStore.get(slug);
            return (
              <StoreTile
                key={slug}
                product={product}
                slug={slug}
                name={offer?.storeName || STORES[slug]?.name || slug}
                offer={offer}
                status={statusFor(slug)}
                hiddenByFilters={!offer && hiddenStores.has(slug)}
                isBest={Boolean(bestOffer && offer && offer.productUrl === bestOffer.productUrl)}
              />
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-400 dark:border-slate-800">
          <span className="flex items-center gap-1">
            <Icon name="clock" className="h-3.5 w-3.5" />
            Checked {timeAgo(lastChecked) || 'just now'}
            {offers.length > sellerCount && ` · ${offers.length} listings`}
          </span>
          <div className="flex items-center gap-4">
            <PriceAlertButton
              product={product}
              label="Price alert"
              className="inline-flex items-center gap-1 font-semibold text-slate-500 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-300"
            />
            <Link
              to={to}
              state={{ product }}
              className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200"
            >
              Price history &amp; all offers
              <Icon name="chevronRight" className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
