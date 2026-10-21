import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from './Icon';
import { Spinner, StoreBadge } from './ui';
import { accountApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { bestOfferPerStore, formatPriceINR } from '../utils/formatters';

// Sends logged-out users to /login and back to this page afterwards.
function useRequireLogin() {
  const { user } = useAuth();
  const { toast } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  return (message) => {
    if (user) return true;
    toast(message || 'Please log in to set up email alerts', { type: 'info' });
    navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, {
      state: location.state,
    });
    return false;
  };
}

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 animate-fade-in bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-[90vh] w-full max-w-md animate-slide-up overflow-y-auto rounded-t-3xl bg-white p-6 shadow-lift dark:bg-slate-900 sm:rounded-3xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
          <button type="button" onClick={onClose} className="btn-icon -mr-2 -mt-2 h-9 w-9" aria-label="Close">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PriceAlertForm({ product, onDone }) {
  const { toast } = useApp();
  const stores = [...bestOfferPerStore(product.offers || []).values()];
  const reference = product.bestOffer?.price ?? Math.min(...stores.map((o) => o.price ?? Infinity));
  const suggested = Number.isFinite(reference) ? Math.floor(reference * 0.9) : '';
  const [target, setTarget] = useState(String(suggested));
  const [scope, setScope] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selectedOffer = scope === 'all' ? null : stores.find((o) => o.storeSlug === scope);
  const compareTo = selectedOffer?.price ?? (Number.isFinite(reference) ? reference : null);
  const value = Number(target);

  const submit = async (e) => {
    e.preventDefault();
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter a target price greater than ₹0.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await accountApi.createPriceAlert(product, { targetPrice: value, offer: selectedOffer });
      toast(`Price alert set — we’ll email you at ${formatPriceINR(value)} or lower`);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{product.name}</p>
      <div>
        <label className="label" htmlFor="alert-target">Email me when the price is at or below</label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-semibold text-slate-400">₹</span>
          <input
            id="alert-target"
            type="number"
            inputMode="decimal"
            min="1"
            step="1"
            className="input pl-8 text-lg font-semibold"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            autoFocus
          />
        </div>
        {compareTo != null && value > 0 && (
          <p className={`mt-1.5 text-xs ${value >= compareTo ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}>
            {value >= compareTo
              ? `That’s at or above today’s ${formatPriceINR(compareTo)} — you’ll be notified after the next price check.`
              : `${Math.round(((compareTo - value) / compareTo) * 100)}% below today’s ${formatPriceINR(compareTo)}.`}
          </p>
        )}
      </div>

      <fieldset>
        <legend className="label">Watch at</legend>
        <div className="space-y-2">
          <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${scope === 'all' ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10' : 'border-slate-200 dark:border-slate-700'}`}>
            <input type="radio" name="scope" value="all" checked={scope === 'all'} onChange={() => setScope('all')} className="text-brand-600" />
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Any store (cheapest price)</span>
          </label>
          {stores.map((o) => (
            <label
              key={o.storeSlug}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${scope === o.storeSlug ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10' : 'border-slate-200 dark:border-slate-700'}`}
            >
              <input type="radio" name="scope" value={o.storeSlug} checked={scope === o.storeSlug} onChange={() => setScope(o.storeSlug)} className="text-brand-600" />
              <StoreBadge slug={o.storeSlug} name={o.storeName} size="sm" />
              <span className="ml-auto text-sm font-semibold text-slate-700 dark:text-slate-200">{formatPriceINR(o.price)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {error && <p className="text-sm font-medium text-rose-600 dark:text-rose-400" role="alert">{error}</p>}
      <button type="submit" className="btn-primary w-full py-3" disabled={busy}>
        {busy ? <Spinner /> : <Icon name="bell" className="h-4 w-4" />}
        {busy ? 'Saving…' : 'Set price alert'}
      </button>
      <p className="text-center text-xs text-slate-400">Prices are re-checked automatically every few hours. Manage alerts from your dashboard.</p>
    </form>
  );
}

export function PriceAlertButton({ product, className = 'btn-secondary', label = 'Set price alert', compact = false }) {
  const [open, setOpen] = useState(false);
  const requireLogin = useRequireLogin();
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (requireLogin('Log in to get an email when the price drops')) setOpen(true);
        }}
        title="Email me when the price drops"
      >
        <Icon name="bell" className="h-4 w-4" />
        {!compact && label}
      </button>
      {open && (
        <Modal title="Set a price alert" onClose={() => setOpen(false)}>
          <PriceAlertForm product={product} onDone={() => setOpen(false)} />
        </Modal>
      )}
    </>
  );
}

// "Notify me when available" for one out-of-stock store listing.
export function StockAlertButton({ product, offer, className = '' }) {
  const requireLogin = useRequireLogin();
  const { toast } = useApp();
  const [state, setState] = useState('idle'); // idle | busy | done
  return (
    <button
      type="button"
      disabled={state !== 'idle'}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!requireLogin('Log in to get an email when this is back in stock')) return;
        setState('busy');
        try {
          await accountApi.createStockAlert(product, offer);
          setState('done');
          toast(`We’ll email you when it’s back at ${offer.storeName}`);
        } catch (err) {
          setState('idle');
          toast(err.message, { type: err.status === 409 ? 'info' : 'error' });
        }
      }}
      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition-colors ${
        state === 'done'
          ? 'bg-deal-50 text-deal-700 dark:bg-deal-500/10 dark:text-deal-500'
          : 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-500/10 dark:text-brand-300 dark:hover:bg-brand-500/20'
      } ${className}`}
    >
      {state === 'busy' ? <Spinner className="h-3 w-3" /> : <Icon name={state === 'done' ? 'check' : 'bell'} className="h-3.5 w-3.5" />}
      {state === 'done' ? 'You’ll be notified' : 'Notify me when available'}
    </button>
  );
}
