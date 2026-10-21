import { useState } from 'react';
import Icon from './Icon';
import { useApp } from '../context/AppContext';
import { availabilityMeta, formatCompact, storeMeta } from '../utils/formatters';

export function StoreBadge({ slug, name, size = 'md' }) {
  const meta = storeMeta(slug, name);
  const box = size === 'sm' ? 'h-5 w-5 text-[10px]' : 'h-7 w-7 text-xs';
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span
        className={`${box} inline-flex shrink-0 items-center justify-center rounded-lg font-bold uppercase text-white shadow-sm`}
        style={{ backgroundColor: meta.color }}
        aria-hidden="true"
      >
        {meta.initial}
      </span>
      <span className="truncate font-semibold text-slate-800 dark:text-slate-100">{name || meta.name}</span>
    </span>
  );
}

export function RatingStars({ rating, count, compact = false }) {
  if (!rating) return null;
  const tone =
    rating >= 4 ? 'bg-deal-600' : rating >= 3 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
      <span className={`inline-flex items-center gap-0.5 rounded-md ${tone} px-1.5 py-0.5 font-semibold text-white`}>
        {rating.toFixed(1)}
        <Icon name="star" filled className="h-3 w-3" />
      </span>
      {count ? <span>{compact ? formatCompact(count) : count.toLocaleString('en-IN')} ratings</span> : null}
    </span>
  );
}

export function AvailabilityBadge({ status }) {
  const meta = availabilityMeta(status);
  return (
    <span className={`badge ${meta.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

export function SaveButton({ product, className = '', withLabel = false }) {
  const { isSaved, toggleSaved } = useApp();
  const saved = isSaved(product);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSaved(product);
      }}
      aria-pressed={saved}
      aria-label={saved ? 'Remove from watchlist' : 'Save to watchlist'}
      title={saved ? 'Remove from watchlist' : 'Save to watchlist & track price'}
      className={`${withLabel ? 'btn-secondary' : 'btn-icon'} ${saved ? 'text-rose-500 hover:text-rose-600 dark:text-rose-400' : ''} ${className}`}
    >
      <Icon name="heart" filled={saved} className={`h-5 w-5 transition-transform ${saved ? 'scale-110' : ''}`} />
      {withLabel && (saved ? 'Saved' : 'Save & track')}
    </button>
  );
}

export function ProductImage({ src, alt, className = '' }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={`flex items-center justify-center text-slate-300 dark:text-slate-600 ${className}`}>
        <Icon name="bag" className="h-1/3 w-1/3" strokeWidth={1.5} />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`object-contain ${className}`}
    />
  );
}

export function EmptyState({ icon = 'search', title, children, action }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center animate-fade-in">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
        <Icon name={icon} className="h-7 w-7" />
      </div>
      <h3 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h3>
      {children && <div className="mt-1.5 max-w-md text-sm text-slate-500 dark:text-slate-400">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Spinner({ className = 'h-4 w-4' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
