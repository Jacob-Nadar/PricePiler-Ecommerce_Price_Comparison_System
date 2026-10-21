import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi } from '../services/api';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import Icon from '../components/Icon';
import { Modal } from '../components/AlertControls';
import { AvailabilityBadge, EmptyState, Spinner, StoreBadge } from '../components/ui';
import { formatPriceINR, formatTime, timeAgo } from '../utils/formatters';

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'chart' },
  { id: 'users', label: 'Users', icon: 'heart' },
  { id: 'alerts', label: 'Alerts', icon: 'bell' },
  { id: 'listings', label: 'Listings', icon: 'tag' },
  { id: 'emails', label: 'Emails', icon: 'clock' },
  { id: 'audit', label: 'Audit log', icon: 'shield' },
];

const TONES = {
  green: 'bg-deal-50 text-deal-700 dark:bg-deal-500/10 dark:text-deal-500',
  blue: 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  red: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400',
  gray: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};
const STATUS_TONE = {
  active: 'blue', triggered: 'green', notified: 'green', paused: 'amber', cancelled: 'gray',
  sent: 'green', logged: 'amber', failed: 'red', pending: 'gray', admin: 'blue', user: 'gray', disabled: 'red',
};
const Pill = ({ children, tone }) => <span className={`badge ${TONES[tone || STATUS_TONE[children] || 'gray']}`}>{children}</span>;

// Paged, searchable list loader shared by every tab.
function useAdminList(fetcher, filters) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const filterKey = JSON.stringify(filters);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => setPage(1), [filterKey]);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const data = await fetcher({ search: query, page, pageSize: 20, ...filters });
      setState({ loading: false, error: '', data });
    } catch (err) {
      setState({ loading: false, error: err.message, data: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, page, filterKey]);

  useEffect(() => {
    load();
  }, [load]);

  return { search, setSearch, page, setPage, ...state, reload: load };
}

function Toolbar({ search, setSearch, placeholder, children }) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input className="input pl-9" placeholder={placeholder} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {children}
    </div>
  );
}

function Select({ value, onChange, options, label }) {
  return (
    <select className="input sm:w-44" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}

function Pager({ data, page, setPage }) {
  if (!data || data.total <= data.pageSize) return null;
  const pages = Math.ceil(data.total / data.pageSize);
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
      <span>
        {(page - 1) * data.pageSize + 1}–{Math.min(page * data.pageSize, data.total)} of {data.total}
      </span>
      <div className="flex gap-2">
        <button type="button" className="btn-secondary py-1.5" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <button type="button" className="btn-secondary py-1.5" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

// Card list on phones, table from md up.
function DataTable({ list, columns, empty, rowKey = (r) => r.id, onRowClick }) {
  if (list.error) return <EmptyState icon="alert" title="Could not load data">{list.error}</EmptyState>;
  if (list.loading && !list.data) {
    return <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-12 rounded-xl" />)}</div>;
  }
  const items = list.data?.items || [];
  if (!items.length) return <EmptyState icon="search" title={empty} />;
  return (
    <div className={list.loading ? 'opacity-60 transition-opacity' : ''}>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
            <tr>
              {columns.map((c) => (
                <th key={c.label} className={`px-4 py-3 font-semibold ${c.className || ''}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? 'cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50' : ''}
              >
                {columns.map((c) => (
                  <td key={c.label} className={`px-4 py-3 align-top ${c.className || ''}`}>{c.render(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager data={list.data} page={list.page} setPage={list.setPage} />
    </div>
  );
}

function Stat({ label, value, sub, icon }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <Icon name={icon} className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="mt-1 font-display text-2xl font-extrabold text-slate-900 dark:text-white">{value ?? 0}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sub}</div>}
    </div>
  );
}

function Overview({ onOpenUser }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    adminApi.overview().then(setData).catch((err) => setError(err.message));
  }, []);
  if (error) return <EmptyState icon="alert" title="Could not load overview">{error}</EmptyState>;
  if (!data) return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[...Array(8)].map((_, i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}</div>;
  const { users, priceAlerts, stockAlerts, emails7d, catalog } = data;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon="heart" label="Users" value={users.users} sub={`${users.newUsers7d || 0} new · ${users.active7d || 0} active this week`} />
        <Stat icon="bell" label="Price alerts" value={priceAlerts.total} sub={`${priceAlerts.active || 0} active · ${priceAlerts.triggered || 0} triggered`} />
        <Stat icon="bag" label="Stock alerts" value={stockAlerts.total} sub={`${stockAlerts.active || 0} watching · ${stockAlerts.notified || 0} notified`} />
        <Stat icon="clock" label="Emails (7 days)" value={(emails7d.sent || 0) + (emails7d.logged || 0)} sub={`${emails7d.failed || 0} failed · ${emails7d.alertEmails || 0} alerts`} />
        <Stat icon="tag" label="Products" value={catalog.products} sub={`${catalog.listings || 0} store listings`} />
        <Stat icon="chart" label="Price snapshots" value={catalog.snapshots} />
        <Stat icon="alert" label="Failing listings" value={catalog.failing} sub="Last check failed" />
        <Stat icon="refresh" label="Last successful check" value={catalog.lastSuccess ? timeAgo(catalog.lastSuccess) : 'Never'} />
      </div>
      <div>
        <h3 className="mb-3 font-sans text-base font-bold text-slate-900 dark:text-white">Newest users</h3>
        <ul className="card divide-y divide-slate-100 dark:divide-slate-800">
          {data.recentUsers.map((u) => (
            <li key={u.id}>
              <button type="button" onClick={() => onOpenUser(u.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900 dark:text-white">{u.fullName}</span>
                  <span className="block truncate text-xs text-slate-500">{u.email}</span>
                </span>
                {u.role === 'admin' && <Pill>admin</Pill>}
                <span className="text-xs text-slate-400">{timeAgo(u.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Users({ onOpenUser, refreshKey }) {
  const [role, setRole] = useState('');
  const list = useAdminList(adminApi.users, { role, refreshKey });
  return (
    <>
      <Toolbar search={list.search} setSearch={list.setSearch} placeholder="Search by name or email">
        <Select label="Filter users" value={role} onChange={setRole} options={[['', 'All users'], ['user', 'Customers'], ['admin', 'Admins'], ['disabled', 'Disabled']]} />
      </Toolbar>
      <DataTable
        list={list}
        empty="No users found"
        onRowClick={(u) => onOpenUser(u.id)}
        columns={[
          { label: 'User', render: (u) => (
            <div>
              <div className="font-semibold text-slate-900 dark:text-white">{u.fullName}</div>
              <div className="text-xs text-slate-500">{u.email}</div>
            </div>
          ) },
          { label: 'Status', render: (u) => (
            <div className="flex flex-wrap gap-1">
              <Pill>{u.role}</Pill>
              {u.disabledAt && <Pill>disabled</Pill>}
              {u.lockedUntil && new Date(u.lockedUntil) > new Date() && <Pill tone="amber">locked</Pill>}
              {u.loginOtpEnabled && <Pill tone="green">2FA</Pill>}
            </div>
          ) },
          { label: 'Saved', className: 'text-right', render: (u) => u.savedCount },
          { label: 'Price / stock alerts', className: 'text-right', render: (u) => `${u.priceAlertCount} / ${u.stockAlertCount}` },
          { label: 'Last login', render: (u) => <span className="text-xs text-slate-500">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : '—'}</span> },
          { label: 'Joined', render: (u) => <span className="text-xs text-slate-500">{formatTime(u.createdAt)}</span> },
        ]}
      />
    </>
  );
}

function UserDetail({ userId, onClose, onChanged }) {
  const { user: me } = useAuth();
  const { toast } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    adminApi.user(userId).then(setData).catch((err) => setError(err.message));
  }, [userId]);
  useEffect(load, [load]);

  const act = async (action, confirmText, run) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(action);
    try {
      await run();
      toast('Done');
      onChanged();
      if (action === 'delete') onClose();
      else load();
    } catch (err) {
      toast(err.message, { type: 'error' });
    } finally {
      setBusy('');
    }
  };

  const u = data?.user;
  const editable = u && u.role !== 'admin' && u.id !== me.id;

  return (
    <Modal title="Customer details" onClose={onClose}>
      {error ? (
        <p className="text-sm text-rose-600">{error}</p>
      ) : !data ? (
        <div className="flex justify-center py-10"><Spinner className="h-6 w-6 text-slate-400" /></div>
      ) : (
        <div className="space-y-5 text-sm">
          <div>
            <p className="text-lg font-bold text-slate-900 dark:text-white">{u.fullName}</p>
            <p className="break-all text-slate-500">{u.email}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              <Pill>{u.role}</Pill>
              {u.emailVerifiedAt && <Pill tone="green">verified</Pill>}
              {u.disabledAt && <Pill>disabled</Pill>}
              {u.loginOtpEnabled && <Pill tone="green">2FA</Pill>}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div><dt className="text-slate-400">Joined</dt><dd>{formatTime(u.createdAt)}</dd></div>
              <div><dt className="text-slate-400">Last login</dt><dd>{u.lastLoginAt ? formatTime(u.lastLoginAt) : '—'}</dd></div>
              <div><dt className="text-slate-400">Active sessions</dt><dd>{data.sessions.length}</dd></div>
              <div><dt className="text-slate-400">Failed logins</dt><dd>{u.failedLoginAttempts}</dd></div>
            </dl>
          </div>

          {editable ? (
            <div className="flex flex-wrap gap-2">
              {u.disabledAt ? (
                <button type="button" className="btn-secondary py-1.5" disabled={!!busy} onClick={() => act('enable', null, () => adminApi.userAction(u.id, 'enable'))}>Enable account</button>
              ) : (
                <button type="button" className="btn-secondary py-1.5" disabled={!!busy} onClick={() => act('disable', `Disable ${u.email}? They will be signed out and cannot log in.`, () => adminApi.userAction(u.id, 'disable'))}>Disable account</button>
              )}
              <button type="button" className="btn-secondary py-1.5" disabled={!!busy || !data.sessions.length} onClick={() => act('sign_out', null, () => adminApi.userAction(u.id, 'sign_out'))}>Sign out everywhere</button>
              {u.lockedUntil && (
                <button type="button" className="btn-secondary py-1.5" disabled={!!busy} onClick={() => act('unlock', null, () => adminApi.userAction(u.id, 'unlock'))}>Unlock</button>
              )}
              <button
                type="button"
                className="btn py-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                disabled={!!busy}
                onClick={() => act('delete', `Permanently delete ${u.email} and all their saved products, alerts and notifications? This cannot be undone.`, () => adminApi.deleteUser(u.id))}
              >
                <Icon name="trash" className="h-4 w-4" /> Delete user
              </button>
            </div>
          ) : (
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800">
              {u.id === me.id ? 'This is your own account.' : 'Admin accounts are managed with the admin:create command.'}
            </p>
          )}

          <section>
            <h4 className="mb-2 font-semibold text-slate-900 dark:text-white">Tracked products ({data.saved.length})</h4>
            {data.saved.length ? (
              <ul className="space-y-1.5">
                {data.saved.map((s) => (
                  <li key={s.productId} className="flex justify-between gap-2">
                    <Link to={`/product/${s.productId}`} className="line-clamp-1 text-brand-600 hover:underline dark:text-brand-300">{s.name}</Link>
                    <span className="shrink-0 text-slate-500">{s.bestOffer ? formatPriceINR(s.bestOffer.price) : '—'}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-slate-400">None</p>}
          </section>

          <section>
            <h4 className="mb-2 font-semibold text-slate-900 dark:text-white">Price alerts ({data.priceAlerts.length})</h4>
            {data.priceAlerts.length ? (
              <ul className="space-y-1.5">
                {data.priceAlerts.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 flex-1">{a.productName}</span>
                    <span className="shrink-0 text-xs text-slate-500">≤ {formatPriceINR(a.targetPrice)}</span>
                    <Pill>{a.status}</Pill>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-slate-400">None</p>}
          </section>

          <section>
            <h4 className="mb-2 font-semibold text-slate-900 dark:text-white">Stock alerts ({data.stockAlerts.length})</h4>
            {data.stockAlerts.length ? (
              <ul className="space-y-1.5">
                {data.stockAlerts.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 flex-1">{s.productName}</span>
                    <span className="shrink-0 text-xs text-slate-500">{s.retailerName}</span>
                    <Pill>{s.status}</Pill>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-slate-400">None</p>}
          </section>

          <section>
            <h4 className="mb-2 font-semibold text-slate-900 dark:text-white">Recent alert emails ({data.notifications.total})</h4>
            {data.notifications.items.length ? (
              <ul className="space-y-1.5">
                {data.notifications.items.map((n) => (
                  <li key={n.id} className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 flex-1 text-xs">{n.subject}</span>
                    <Pill>{n.status}</Pill>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-slate-400">None</p>}
          </section>
        </div>
      )}
    </Modal>
  );
}

function Alerts() {
  const { toast } = useApp();
  const [kind, setKind] = useState('price');
  const [status, setStatus] = useState('');
  const list = useAdminList((p) => adminApi.alerts(kind, p), { kind, status });
  const statuses = kind === 'price' ? ['active', 'triggered', 'paused', 'cancelled'] : ['active', 'notified', 'paused', 'cancelled'];

  const act = async (row, action) => {
    if (action === 'delete' && !window.confirm('Delete this alert?')) return;
    try {
      if (action === 'delete') await adminApi.deleteAlert(kind, row.id);
      else await adminApi.alertAction(kind, row.id, action);
      toast('Alert updated');
      list.reload();
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  };

  return (
    <>
      <Toolbar search={list.search} setSearch={list.setSearch} placeholder="Search by product or customer email">
        <Select label="Alert type" value={kind} onChange={(v) => { setKind(v); setStatus(''); }} options={[['price', 'Price alerts'], ['stock', 'Stock alerts']]} />
        <Select label="Status" value={status} onChange={setStatus} options={[['', 'Any status'], ...statuses.map((s) => [s, s[0].toUpperCase() + s.slice(1)])]} />
      </Toolbar>
      <DataTable
        list={list}
        rowKey={(r) => `${kind}-${r.id}`}
        empty="No alerts found"
        columns={[
          { label: 'Product', render: (r) => <Link to={`/product/${r.productId}`} className="line-clamp-2 font-medium text-slate-900 hover:text-brand-600 dark:text-white">{r.productName}</Link> },
          { label: 'Customer', render: (r) => <span className="text-xs">{r.userEmail}</span> },
          kind === 'price'
            ? { label: 'Target / last seen', render: (r) => <span className="whitespace-nowrap">{formatPriceINR(r.targetPrice)} / {formatPriceINR(r.lastSeenPrice)}</span> }
            : { label: 'Availability', render: (r) => <AvailabilityBadge status={r.availability} /> },
          { label: 'Store', render: (r) => <span className="text-xs">{r.retailerName || 'Any store'}</span> },
          { label: 'Status', render: (r) => <Pill>{r.status}</Pill> },
          { label: 'Last emailed', render: (r) => <span className="text-xs text-slate-500">{r.lastNotifiedAt ? timeAgo(r.lastNotifiedAt) : '—'}</span> },
          { label: 'Actions', render: (r) => (
            <div className="flex gap-3 text-xs font-semibold">
              {r.status === 'paused' || r.status === 'cancelled'
                ? <button type="button" className="text-slate-500 hover:text-slate-900 dark:hover:text-white" onClick={() => act(r, 'resume')}>Resume</button>
                : <button type="button" className="text-slate-500 hover:text-slate-900 dark:hover:text-white" onClick={() => act(r, 'pause')}>Pause</button>}
              <button type="button" className="text-rose-600 hover:text-rose-700" onClick={() => act(r, 'delete')}>Delete</button>
            </div>
          ) },
        ]}
      />
    </>
  );
}

function Listings() {
  const { toast } = useApp();
  const [filter, setFilter] = useState('tracked');
  const list = useAdminList(adminApi.listings, { filter });
  return (
    <>
      <Toolbar search={list.search} setSearch={list.setSearch} placeholder="Search listings">
        <Select label="Listings" value={filter} onChange={setFilter} options={[['tracked', 'Monitored'], ['failing', 'Failing checks'], ['', 'All listings']]} />
      </Toolbar>
      <DataTable
        list={list}
        empty="No listings found"
        columns={[
          { label: 'Listing', render: (r) => (
            <div className="max-w-xs">
              <Link to={`/product/${r.productId}`} className="line-clamp-2 font-medium text-slate-900 hover:text-brand-600 dark:text-white">{r.title}</Link>
              <div className="mt-1"><StoreBadge slug={r.retailerSlug} name={r.retailerName} size="sm" /></div>
            </div>
          ) },
          { label: 'Price', className: 'text-right', render: (r) => <span className="whitespace-nowrap font-semibold">{formatPriceINR(r.currentPrice)}</span> },
          { label: 'Stock', render: (r) => <AvailabilityBadge status={r.availability} /> },
          { label: 'Last success', render: (r) => <span className="text-xs text-slate-500">{r.lastSuccessAt ? timeAgo(r.lastSuccessAt) : 'never'}</span> },
          { label: 'Health', render: (r) => r.failures > 0
            ? <span className="text-xs text-rose-600 dark:text-rose-400" title={r.lastError || ''}>{r.failures} failure{r.failures === 1 ? '' : 's'}: {String(r.lastError || '').slice(0, 60)}</span>
            : <Pill tone="green">ok</Pill> },
          { label: 'History', className: 'text-right', render: (r) => r.snapshots },
          { label: 'Next check', render: (r) => <span className="text-xs text-slate-500">{r.nextCheckAt ? formatTime(r.nextCheckAt) : '—'}</span> },
          { label: '', render: (r) => (
            <button
              type="button"
              className="whitespace-nowrap text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300"
              onClick={async () => {
                try {
                  await adminApi.checkListing(r.id);
                  toast('Check started — refresh in a few seconds');
                  setTimeout(list.reload, 6000);
                } catch (err) {
                  toast(err.message, { type: 'error' });
                }
              }}
            >
              Check now
            </button>
          ) },
        ]}
      />
    </>
  );
}

function Emails() {
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const list = useAdminList(adminApi.notifications, { type, status });
  return (
    <>
      <Toolbar search={list.search} setSearch={list.setSearch} placeholder="Search by email or subject">
        <Select label="Email type" value={type} onChange={setType} options={[['', 'All types'], ['price_drop', 'Price drop'], ['back_in_stock', 'Back in stock'], ['otp_register', 'Signup code'], ['otp_login', 'Login code'], ['otp_reset', 'Reset code']]} />
        <Select label="Delivery status" value={status} onChange={setStatus} options={[['', 'Any status'], ['sent', 'Sent'], ['logged', 'Logged'], ['failed', 'Failed']]} />
      </Toolbar>
      <DataTable
        list={list}
        empty="No emails found"
        columns={[
          { label: 'When', render: (n) => <span className="whitespace-nowrap text-xs text-slate-500">{formatTime(n.createdAt)}</span> },
          { label: 'Type', render: (n) => <span className="text-xs font-medium">{n.type.replace(/_/g, ' ')}</span> },
          { label: 'Recipient', render: (n) => <span className="text-xs">{n.userEmail || '(sent before signup)'}</span> },
          { label: 'Subject', render: (n) => <span className="line-clamp-2 text-xs">{n.subject}</span> },
          { label: 'Status', render: (n) => (
            <div>
              <Pill>{n.status}</Pill>
              {n.error && <p className="mt-1 max-w-[16rem] text-[11px] text-rose-600" title={n.error}>{n.error.slice(0, 80)}</p>}
            </div>
          ) },
        ]}
      />
    </>
  );
}

function Audit() {
  const list = useAdminList(adminApi.audit, {});
  return (
    <DataTable
      list={list}
      empty="No admin actions yet"
      columns={[
        { label: 'When', render: (a) => <span className="whitespace-nowrap text-xs text-slate-500">{formatTime(a.createdAt)}</span> },
        { label: 'Admin', render: (a) => <span className="text-xs">{a.adminEmail || '(deleted)'}</span> },
        { label: 'Action', render: (a) => <code className="text-xs">{a.action}</code> },
        { label: 'Target', render: (a) => <span className="text-xs">{a.targetType} #{a.targetId}{a.details?.email ? ` (${a.details.email})` : ''}</span> },
        { label: 'IP', render: (a) => <span className="text-xs text-slate-400">{a.ip || '—'}</span> },
      ]}
    />
  );
}

export default function Admin() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'overview';
  const [openUser, setOpenUser] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="container-page py-6 sm:py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="badge bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
            <Icon name="shield" className="h-3.5 w-3.5" /> Admin
          </span>
          <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">Admin panel</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Customers, alerts, monitored listings and email delivery. Every change is recorded in the audit log.</p>
        </div>
      </div>

      <div className="scrollbar-none -mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 dark:border-slate-800 sm:mx-0 sm:px-0" role="tablist">
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
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview onOpenUser={setOpenUser} />}
      {tab === 'users' && <Users onOpenUser={setOpenUser} refreshKey={refreshKey} />}
      {tab === 'alerts' && <Alerts />}
      {tab === 'listings' && <Listings />}
      {tab === 'emails' && <Emails />}
      {tab === 'audit' && <Audit />}

      {openUser && (
        <UserDetail userId={openUser} onClose={() => setOpenUser(null)} onChanged={() => setRefreshKey((k) => k + 1)} />
      )}
    </div>
  );
}
