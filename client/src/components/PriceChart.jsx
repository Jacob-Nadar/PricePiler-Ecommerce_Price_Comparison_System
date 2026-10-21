import { useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import Icon from './Icon';
import { Spinner } from './ui';
import { formatPriceINR, storeMeta, timeAgo } from '../utils/formatters';

export const RANGES = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: 'all', label: 'All' },
];

// Distinct line colours when one retailer has several variant listings.
const VARIANT_SHADES = ['', '#7c3aed', '#0891b2', '#db2777'];

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lift backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
      <div className="mb-1 font-semibold text-slate-700 dark:text-slate-200">
        {new Date(label).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
      </div>
      {payload
        .filter((p) => p.value != null)
        .map((p) => (
          <div key={p.dataKey} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-slate-500 dark:text-slate-400">{p.name}</span>
            <span className="ml-auto pl-3 font-semibold text-slate-900 dark:text-white">{formatPriceINR(p.value)}</span>
          </div>
        ))}
    </div>
  );
}

function Stat({ label, value, tone = 'text-slate-900 dark:text-white', children }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 font-display text-lg font-bold ${tone}`}>{value}</div>
      {children}
    </div>
  );
}

/**
 * series: [{ key, storeSlug, storeName, variant?, points: [{ recordedAt, price }], stats? }]
 * range / onRangeChange: optional time-range control (7d, 30d, 90d, all).
 */
export default function PriceChart({ series = [], range, onRangeChange, loading = false, emptyHint }) {
  const [hidden, setHidden] = useState(() => new Set());

  const lines = useMemo(() => {
    const perStoreCount = new Map();
    return series
      .filter((s) => s.points?.some((p) => p.price != null))
      .map((s) => {
        const n = perStoreCount.get(s.storeSlug) || 0;
        perStoreCount.set(s.storeSlug, n + 1);
        const meta = storeMeta(s.storeSlug, s.storeName);
        return {
          key: s.key || `${s.storeSlug}-${n}`,
          name: `${s.storeName || meta.name}${s.variant && series.filter((o) => o.storeSlug === s.storeSlug).length > 1 ? ` · ${s.variant}` : ''}`,
          color: VARIANT_SHADES[n] || meta.color,
          points: s.points,
          stats: s.stats,
          storeSlug: s.storeSlug,
        };
      });
  }, [series]);

  const visible = lines.filter((l) => !hidden.has(l.key));

  const { data, stats } = useMemo(() => {
    const byTime = new Map();
    for (const line of visible) {
      for (const point of line.points) {
        if (point.price == null) continue;
        const t = new Date(point.recordedAt).getTime();
        const row = byTime.get(t) || { t };
        row[line.key] = Number(point.price);
        byTime.set(t, row);
      }
    }
    const rows = [...byTime.values()].sort((a, b) => a.t - b.t);
    const all = visible.flatMap((l) => l.points.filter((p) => p.price != null).map((p) => ({ ...p, price: Number(p.price) })));
    if (!all.length) return { data: rows, stats: null };
    const prices = all.map((p) => p.price);
    // "Current" is the cheapest latest price across the visible retailers.
    const latestPerLine = visible
      .map((l) => [...l.points].reverse().find((p) => p.price != null))
      .filter(Boolean);
    const current = Math.min(...latestPerLine.map((p) => Number(p.price)));
    const cheapestLine = visible.find((l) => Number([...l.points].reverse().find((p) => p.price != null)?.price) === current);
    const lineStats = cheapestLine?.stats;
    const ordered = [...(cheapestLine?.points || [])].filter((p) => p.price != null);
    const previous = lineStats?.previousPrice ?? [...ordered.slice(0, -1)].reverse().find((p) => Number(p.price) !== current)?.price ?? null;
    const change = previous != null ? current - Number(previous) : 0;
    return {
      data: rows,
      stats: {
        current,
        lowest: Math.min(...prices),
        highest: Math.max(...prices),
        previous: previous != null ? Number(previous) : null,
        change,
        firstSeen: all.map((p) => p.recordedAt).sort()[0],
        points: all.length,
      },
    };
  }, [visible]);

  const toggle = (key) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (lines.length - next.size > 1) next.add(key); // keep at least one line
      return next;
    });

  const header = onRangeChange && (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="tablist" aria-label="Time range">
        {RANGES.map((r) => (
          <button
            key={r.value}
            type="button"
            role="tab"
            aria-selected={range === r.value}
            onClick={() => onRangeChange(r.value)}
            className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
              range === r.value ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      {loading && <Spinner className="h-4 w-4 text-slate-400" />}
    </div>
  );

  if (!lines.length) {
    return (
      <div>
        {header}
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-200 px-6 py-10 text-center dark:border-slate-700">
          <Icon name="chart" className="h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-300">
            {range && range !== 'all' ? 'No price history in this time range' : 'No price history yet'}
          </p>
          <p className="mt-1 max-w-xs text-xs text-slate-400">
            {emptyHint || 'We record prices every time this product is searched or checked. Save it or set an alert and we’ll keep checking it for you.'}
          </p>
        </div>
      </div>
    );
  }

  const padding = Math.max((stats.highest - stats.lowest) * 0.15, stats.highest * 0.02, 10);
  const singlePoint = data.length < 2;
  const direction = stats.change < 0 ? 'down' : stats.change > 0 ? 'up' : 'same';

  return (
    <div>
      {header}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Current best" value={formatPriceINR(stats.current)}>
          {direction !== 'same' ? (
            <div className={`mt-0.5 flex items-center gap-1 text-[11px] font-semibold ${direction === 'down' ? 'text-deal-600 dark:text-deal-500' : 'text-rose-600 dark:text-rose-400'}`}>
              <Icon name={direction === 'down' ? 'trendingDown' : 'trendingUp'} className="h-3.5 w-3.5" />
              {direction === 'down' ? 'Down' : 'Up'} {formatPriceINR(Math.abs(stats.change))}
            </div>
          ) : (
            <div className="mt-0.5 text-[11px] text-slate-400">No change</div>
          )}
        </Stat>
        <Stat label="Previous" value={stats.previous != null ? formatPriceINR(stats.previous) : '—'} />
        <Stat label="Lowest" value={formatPriceINR(stats.lowest)} tone="text-deal-600 dark:text-deal-500" />
        <Stat label="Highest" value={formatPriceINR(stats.highest)} tone="text-rose-600 dark:text-rose-400" />
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-200 dark:text-slate-800" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={singlePoint ? [data[0].t - 86400000, data[0].t + 86400000] : ['dataMin', 'dataMax']}
              tickFormatter={(t) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              stroke="#94a3b8"
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            <YAxis
              domain={[Math.max(0, Math.floor(stats.lowest - padding)), Math.ceil(stats.highest + padding)]}
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(v) => (v >= 1000 ? `₹${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `₹${v}`)}
            />
            <Tooltip content={<ChartTooltip />} />
            {visible.map((line) => (
              <Line
                key={line.key}
                type="stepAfter"
                dataKey={line.key}
                name={line.name}
                stroke={line.color}
                strokeWidth={2.5}
                dot={{ r: singlePoint ? 5 : 3, strokeWidth: 0, fill: line.color }}
                activeDot={{ r: 6 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex flex-wrap gap-1.5" aria-label="Compare retailers">
          {lines.map((line) => {
            const off = hidden.has(line.key);
            return (
              <button
                key={line.key}
                type="button"
                onClick={() => toggle(line.key)}
                aria-pressed={!off}
                title={off ? 'Show on chart' : 'Hide from chart'}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium transition-opacity ${
                  off ? 'border-slate-200 opacity-50 dark:border-slate-700' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                }`}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: line.color }} />
                {line.name}
                {line.stats?.current != null && <span className="text-slate-400">· {formatPriceINR(line.stats.current)}</span>}
              </button>
            );
          })}
        </div>
        <span>
          Since {timeAgo(stats.firstSeen)} · {stats.points} price point{stats.points === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}
