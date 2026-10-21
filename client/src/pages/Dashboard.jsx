import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { accountApi, authApi, healthCheck } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import Icon from '../components/Icon';
import { PriceAlertButton } from '../components/AlertControls';
import { AvailabilityBadge, EmptyState, ProductImage, Spinner, StoreBadge } from '../components/ui';
import { formatPriceINR, formatTime, shortStoreName, timeAgo } from '../utils/formatters';

const TABS = [
  { id: 'saved', label: 'Tracked products', icon: 'heart' },
  { id: 'price', label: 'Price alerts', icon: 'bell' },
  { id: 'stock', label: 'Stock alerts', icon: 'bag' },
  { id: 'notifications', label: 'Notifications', icon: 'clock' },
];

const PRICE_STATUS = {
  active: { label: 'Active', className: 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300' },
  triggered: { label: 'Triggered', className: 'bg-deal-50 text-deal-700 dark:bg-deal-500/10 dark:text-deal-500' },
  paused: { label: 'Paused', className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' },
  cancelled: { label: 'Cancelled', className: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};
const STOCK_STATUS = {
  active: { label: 'Watching', className: PRICE_STATUS.active.className },
  notified: { label: 'Notified', className: PRICE_STATUS.triggered.className },
  paused: PRICE_STATUS.paused,
  cancelled: PRICE_STATUS.cancelled,
};

function StatusBadge({ map, status }) {
  const meta = map[status] || { label: status, className: '' };
  return <span className={`badge ${meta.className}`}>{meta.label}</span>;
}

// A saved product from the API, in the shape ProductCard/alerts expect.
function savedToProduct(item) {
  return {
    name: item.name,
    brand: item.brand,
    imageUrl: item.imageUrl,
    specifications: item.specifications,
    offers: item.offers.map((o) => ({ ...o, title: o.title })),
    bestOffer: item.bestOffer,
  };
}

function SavedList({ items, onRemove }) {
  if (!items.length) {
    return (
      <EmptyState icon="heart" title="No tracked products yet" action={<Link to="/" className="btn-primary">Find products</Link>}>
        Tap the heart on any product. We’ll re-check its price at every store automatically and build its price history.
      </EmptyState>
    );
  }
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.productId} className="card flex gap-4 p-4">
          <Link to={`/product/${item.productId}`} className="h-20 w-20 shrink-0 rounded-xl border border-slate-100 bg-white p-2 dark:border-slate-800">
            <ProductImage src={item.imageUrl} alt={item.name} className="h-full w-full" />
          </Link>
          <div className="min-w-0 flex-1">
            <Link to={`/product/${item.productId}`} className="line-clamp-2 font-semibold text-slate-900 hover:text-brand-700 dark:text-white dark:hover:text-brand-300">
              {item.name}
            </Link>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              {item.bestOffer ? (
                <>
                  <span className="font-display text-lg font-bold text-slate-900 dark:text-white">{formatPriceINR(item.bestOffer.price)}</span>
                  <span className="text-slate-500 dark:text-slate-400">at {shortStoreName(item.bestOffer.storeName)}</span>
                </>
              ) : (
                <span className="text-slate-500 dark:text-slate-400">Waiting for the first price check…</span>
              )}
              {item.lowestRecorded != null && (
                <span className="text-xs text-slate-400">Lowest recorded {formatPriceINR(item.lowestRecorded)}</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <PriceAlertButton
                product={savedToProduct(item)}
                className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300"
              />
              <button type="button" onClick={() => onRemove(item)} className="inline-flex items-center gap-1 font-semibold text-slate-500 hover:text-rose-600">
                <Icon name="trash" className="h-3.5 w-3.5" /> Remove
              </button>
              <span className="ml-auto text-slate-400">
                {item.offers.length} store listing{item.offers.length === 1 ? '' : 's'} · checked {item.lastChecked ? timeAgo(item.lastChecked) : 'soon'}
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function TargetEditor({ alert, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(alert.targetPrice));
  const [busy, setBusy] = useState(false);
  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300">
        Edit target
      </button>
    );
  }
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const ok = await onSave(Number(value));
        setBusy(false);
        if (ok) setEditing(false);
      }}
    >
      <span className="text-slate-400">₹</span>
      <input type="number" min="1" className="input w-28 px-2 py-1 text-xs" value={value} onChange={(e) => setValue(e.target.value)} autoFocus aria-label="New target price" />
      <button type="submit" className="btn-primary px-2.5 py-1 text-xs" disabled={busy}>Save</button>
      <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(false)}>Cancel</button>
    </form>
  );
}

function PriceAlerts({ items, onAction, onEdit, onDelete }) {
  if (!items.length) {
    return (
      <EmptyState icon="bell" title="No price alerts yet" action={<Link to="/" className="btn-primary">Find a product</Link>}>
        Open any product and choose <strong>Set price alert</strong>. We’ll email you when it reaches your target price.
      </EmptyState>
    );
  }
  return (
    <ul className="space-y-3">
      {items.map((a) => {
        const reached = a.currentPrice != null && a.currentPrice <= a.targetPrice;
        return (
          <li key={a.id} className={`card p-4 ${a.status === 'cancelled' ? 'opacity-70' : ''}`}>
            <div className="flex gap-4">
              <Link to={`/product/${a.productId}`} className="h-16 w-16 shrink-0 rounded-xl border border-slate-100 bg-white p-1.5 dark:border-slate-800">
                <ProductImage src={a.imageUrl} alt={a.productName} className="h-full w-full" />
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/product/${a.productId}`} className="line-clamp-2 text-sm font-semibold text-slate-900 hover:text-brand-700 dark:text-white dark:hover:text-brand-300">
                    {a.productName}
                  </Link>
                  <StatusBadge map={PRICE_STATUS} status={a.status} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div>
                    <div className="text-slate-400">Target</div>
                    <div className="font-display text-base font-bold text-slate-900 dark:text-white">{formatPriceINR(a.targetPrice)}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Current</div>
                    <div className={`font-display text-base font-bold ${reached ? 'text-deal-600 dark:text-deal-500' : 'text-slate-900 dark:text-white'}`}>
                      {a.currentPrice != null ? formatPriceINR(a.currentPrice) : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Watching</div>
                    <div className="font-semibold text-slate-700 dark:text-slate-200">{a.scope === 'all' ? 'Any store' : shortStoreName(a.retailerName)}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Last emailed</div>
                    <div className="font-semibold text-slate-700 dark:text-slate-200">{a.lastNotifiedAt ? timeAgo(a.lastNotifiedAt) : 'Not yet'}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                  {a.status !== 'cancelled' && <TargetEditor alert={a} onSave={(target) => onEdit(a, target)} />}
                  {(a.status === 'active' || a.status === 'triggered') && (
                    <button type="button" onClick={() => onAction(a, 'pause')} className="font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white">Pause</button>
                  )}
                  {(a.status === 'paused' || a.status === 'cancelled') && (
                    <button type="button" onClick={() => onAction(a, 'resume')} className="font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white">Resume</button>
                  )}
                  {a.status !== 'cancelled' && (
                    <button type="button" onClick={() => onAction(a, 'cancel')} className="font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white">Cancel</button>
                  )}
                  <button type="button" onClick={() => onDelete(a)} className="inline-flex items-center gap-1 font-semibold text-slate-500 hover:text-rose-600">
                    <Icon name="trash" className="h-3.5 w-3.5" /> Delete
                  </button>
                  {a.currentUrl && (
                    <a href={a.currentUrl} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white">
                      Visit store <Icon name="external" className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-slate-400">
                  {a.lastCheckedAt ? `Price checked ${timeAgo(a.lastCheckedAt)}` : 'Waiting for the first scheduled price check'}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function StockAlerts({ items, onAction, onDelete }) {
  if (!items.length) {
    return (
      <EmptyState icon="bag" title="No stock alerts yet">
        When a store shows a product as out of stock, choose <strong>Notify me when available</strong> and we’ll email you when it’s back.
      </EmptyState>
    );
  }
  return (
    <ul className="space-y-3">
      {items.map((s) => (
        <li key={s.id} className={`card flex gap-4 p-4 ${s.status === 'cancelled' ? 'opacity-70' : ''}`}>
          <Link to={`/product/${s.productId}`} className="h-16 w-16 shrink-0 rounded-xl border border-slate-100 bg-white p-1.5 dark:border-slate-800">
            <ProductImage src={s.imageUrl} alt={s.productName} className="h-full w-full" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <Link to={`/product/${s.productId}`} className="line-clamp-2 text-sm font-semibold text-slate-900 hover:text-brand-700 dark:text-white dark:hover:text-brand-300">
                {s.productName}
              </Link>
              <StatusBadge map={STOCK_STATUS} status={s.status} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
              <StoreBadge slug={s.retailerSlug} name={s.retailerName} size="sm" />
              {s.variant && <span className="text-slate-400">{s.variant}</span>}
              <AvailabilityBadge status={s.availability} />
              {s.currentPrice != null && <span className="font-semibold text-slate-700 dark:text-slate-200">{formatPriceINR(s.currentPrice)}</span>}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              {(s.status === 'active' || s.status === 'notified') && (
                <button type="button" onClick={() => onAction(s, 'pause')} className="font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white">Pause</button>
              )}
              {(s.status === 'paused' || s.status === 'cancelled') && (
                <button type="button" onClick={() => onAction(s, 'resume')} className="font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white">Resume</button>
              )}
              {s.status !== 'cancelled' && (
                <button type="button" onClick={() => onAction(s, 'cancel')} className="font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white">Unsubscribe</button>
              )}
              <button type="button" onClick={() => onDelete(s)} className="inline-flex items-center gap-1 font-semibold text-slate-500 hover:text-rose-600">
                <Icon name="trash" className="h-3.5 w-3.5" /> Delete
              </button>
              <a href={s.productUrl} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white">
                Visit store <Icon name="external" className="h-3 w-3" />
              </a>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              {s.lastNotifiedAt ? `Emailed ${timeAgo(s.lastNotifiedAt)} · ` : ''}
              {s.lastCheckedAt ? `Availability checked ${timeAgo(s.lastCheckedAt)}` : 'Waiting for the first scheduled check'}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

const DELIVERY = {
  sent: { label: 'Email sent', className: PRICE_STATUS.triggered.className },
  logged: { label: 'Logged (email not configured)', className: PRICE_STATUS.paused.className },
  failed: { label: 'Delivery failed', className: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400' },
  pending: { label: 'Sending', className: PRICE_STATUS.cancelled.className },
};

function Notifications({ initial }) {
  const [items, setItems] = useState(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setItems(initial.items);
    setTotal(initial.total);
  }, [initial.items, initial.total]);
  if (!items.length) {
    return (
      <EmptyState icon="clock" title="No notifications yet">
        Price-drop and back-in-stock emails we send you will be listed here.
      </EmptyState>
    );
  }
  return (
    <div>
      <ul className="card divide-y divide-slate-100 dark:divide-slate-800">
        {items.map((n) => {
          const d = n.details || {};
          return (
            <li key={n.id} className="flex gap-3 p-4">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${n.type === 'price_drop' ? 'bg-deal-50 text-deal-600 dark:bg-deal-500/10' : 'bg-brand-50 text-brand-600 dark:bg-brand-500/10'}`}>
                <Icon name={n.type === 'price_drop' ? 'trendingDown' : 'bag'} className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{n.subject}</p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {n.type === 'price_drop'
                    ? `${d.retailer || ''}: ${formatPriceINR(d.previousPrice)} → ${formatPriceINR(d.currentPrice)} (target ${formatPriceINR(d.targetPrice)})`
                    : `${d.retailer || ''}: back in stock${d.price != null ? ` at ${formatPriceINR(d.price)}` : ''}`}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                  <StatusBadge map={DELIVERY} status={n.status} />
                  <span>{formatTime(n.createdAt)}</span>
                  {d.productUrl && (
                    <a href={d.productUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300">
                      View product
                    </a>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {items.length < total && (
        <button
          type="button"
          className="btn-secondary mt-4 w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const more = await accountApi.notifications(items.length);
              setItems((list) => [...list, ...more.items]);
              setTotal(more.total);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner /> : null} Load more
        </button>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { user, setUser } = useAuth();
  const { toast, reloadSaved } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'saved';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [emailMode, setEmailMode] = useState(null);
  const [savingOtp, setSavingOtp] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await accountApi.dashboard());
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    healthCheck()
      .then((res) => setEmailMode(res.data.email))
      .catch(() => {});
  }, [load]);

  const run = async (promise, message) => {
    try {
      await promise;
      if (message) toast(message);
      await load();
      return true;
    } catch (err) {
      toast(err.message, { type: 'error' });
      return false;
    }
  };

  const actionLabel = { pause: 'paused', resume: 'resumed', cancel: 'cancelled' };

  if (error && !data) {
    return (
      <div className="container-page max-w-3xl py-12">
        <EmptyState icon="alert" title="Could not load your dashboard" action={<button type="button" className="btn-primary" onClick={load}>Try again</button>}>
          {error}
        </EmptyState>
      </div>
    );
  }

  const stats = data?.stats;
  const counts = { saved: stats?.savedProducts, price: data?.priceAlerts.length, stock: data?.stockAlerts.length, notifications: stats?.notifications };

  return (
    <div className="container-page max-w-5xl py-6 sm:py-8">
      <div className="card flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 font-display text-xl font-extrabold text-white">
          {user.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold text-slate-900 dark:text-white">{user.fullName}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <span className="break-all">{user.email}</span>
            {user.emailVerified && (
              <span className="badge bg-deal-50 text-deal-700 dark:bg-deal-500/10 dark:text-deal-500">
                <Icon name="check" className="h-3 w-3" strokeWidth={3} /> Verified
              </span>
            )}
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-700">
          <span className="text-sm">
            <span className="block font-semibold text-slate-800 dark:text-slate-100">Email code at login</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">{user.isAdmin ? 'Always on for admin accounts' : 'Extra security for your account'}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="peer sr-only"
            checked={user.loginOtpEnabled}
            disabled={savingOtp || user.isAdmin}
            onChange={async (e) => {
              setSavingOtp(true);
              try {
                const result = await authApi.updateProfile({ loginOtpEnabled: e.target.checked });
                setUser(result.user);
                toast(result.user.loginOtpEnabled ? 'Login codes turned on' : 'Login codes turned off');
              } catch (err) {
                toast(err.message, { type: 'error' });
              } finally {
                setSavingOtp(false);
              }
            }}
          />
          <span className="relative h-6 w-11 shrink-0 rounded-full bg-slate-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-brand-600 peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 dark:bg-slate-600" />
        </label>
      </div>

      {emailMode === 'console' && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
          Email sending is not configured on the server yet, so alerts are recorded and printed in the server console instead of being emailed.
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Tracked products', value: stats?.savedProducts, icon: 'heart' },
          { label: 'Active price alerts', value: stats?.activePriceAlerts, icon: 'bell' },
          { label: 'Triggered alerts', value: stats?.triggeredPriceAlerts, icon: 'trendingDown' },
          { label: 'Stock alerts', value: stats?.activeStockAlerts, icon: 'bag' },
        ].map((s) => (
          <div key={s.label} className="card p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Icon name={s.icon} className="h-3.5 w-3.5" /> {s.label}
            </div>
            <div className="mt-1 font-display text-2xl font-extrabold text-slate-900 dark:text-white">
              {s.value ?? <span className="skeleton inline-block h-7 w-8 align-middle" />}
            </div>
          </div>
        ))}
      </div>

      <div className="scrollbar-none -mx-4 mt-6 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 dark:border-slate-800 sm:mx-0 sm:px-0" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setParams({ tab: t.id }, { replace: true })}
            className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${
              tab === t.id
                ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <Icon name={t.icon} className="h-4 w-4" />
            {t.label}
            {counts[t.id] != null && <span className="rounded-full bg-slate-100 px-1.5 text-xs dark:bg-slate-800">{counts[t.id]}</span>}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {!data ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-24 rounded-2xl" />
            ))}
          </div>
        ) : tab === 'saved' ? (
          <SavedList
            items={data.saved}
            onRemove={(item) => run(accountApi.unsave(item.productId), 'Removed from tracked products').then(() => reloadSaved())}
          />
        ) : tab === 'price' ? (
          <PriceAlerts
            items={data.priceAlerts}
            onAction={(a, action) => run(accountApi.updatePriceAlert(a.id, { action }), `Alert ${actionLabel[action]}`)}
            onEdit={(a, targetPrice) => run(accountApi.updatePriceAlert(a.id, { targetPrice }), `Target updated to ${formatPriceINR(targetPrice)}`)}
            onDelete={(a) => window.confirm('Delete this price alert?') && run(accountApi.deletePriceAlert(a.id), 'Alert deleted')}
          />
        ) : tab === 'stock' ? (
          <StockAlerts
            items={data.stockAlerts}
            onAction={(s, action) => run(accountApi.updateStockAlert(s.id, { action }), `Subscription ${actionLabel[action]}`)}
            onDelete={(s) => window.confirm('Delete this stock alert?') && run(accountApi.deleteStockAlert(s.id), 'Subscription deleted')}
          />
        ) : (
          <Notifications initial={{ items: data.notifications, total: data.stats.notifications }} />
        )}
      </div>
    </div>
  );
}
