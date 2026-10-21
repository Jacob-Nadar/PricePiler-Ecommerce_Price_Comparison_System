import Icon from './Icon';
import { StoreBadge } from './ui';

export const SORT_OPTIONS = [
  { value: 'relevance', label: 'Best match' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'savings', label: 'Biggest savings' },
  { value: 'discount', label: 'Biggest discount' },
  { value: 'rating', label: 'Top rated' },
];

const AVAILABILITY_OPTIONS = [
  { value: 'all', label: 'Any' },
  { value: 'in_stock', label: 'In stock' },
  { value: 'out_of_stock', label: 'Out of stock' },
];

const RATING_OPTIONS = [0, 3, 3.5, 4, 4.5];

function Section({ title, children }) {
  return (
    <div className="border-t border-slate-100 py-4 first:border-t-0 first:pt-0 dark:border-slate-800">
      <h4 className="label">{title}</h4>
      {children}
    </div>
  );
}

export default function Filters({
  availability,
  setAvailability,
  minPrice,
  setMinPrice,
  maxPrice,
  setMaxPrice,
  minRating,
  setMinRating,
  stores,
  selectedStores,
  toggleStore,
  activeCount,
  onReset,
  onClose,
}) {
  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-sans text-base font-bold text-slate-900 dark:text-white">
          <Icon name="sliders" className="h-4 w-4" />
          Filters
          {activeCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] text-white">
              {activeCount}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-1">
          {activeCount > 0 && (
            <button type="button" onClick={onReset} className="text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300">
              Reset
            </button>
          )}
          {onClose && (
            <button type="button" onClick={onClose} className="btn-icon h-8 w-8 lg:hidden" aria-label="Close filters">
              <Icon name="x" className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <Section title="Availability">
        <div className="flex flex-wrap gap-1.5">
          {AVAILABILITY_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setAvailability(o.value)}
              className={`chip px-2.5 py-1 text-xs ${availability === o.value ? 'chip-active' : ''}`}
              aria-pressed={availability === o.value}
            >
              {o.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Price range (₹)">
        <div className="flex items-center gap-2">
          <input
            className="input py-2"
            type="number"
            inputMode="numeric"
            min="0"
            placeholder="Min"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            aria-label="Minimum price"
          />
          <span className="text-slate-400">–</span>
          <input
            className="input py-2"
            type="number"
            inputMode="numeric"
            min="0"
            placeholder="Max"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            aria-label="Maximum price"
          />
        </div>
      </Section>

      <Section title="Customer rating">
        <div className="flex flex-wrap gap-1.5">
          {RATING_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setMinRating(r)}
              className={`chip px-2.5 py-1 text-xs ${minRating === r ? 'chip-active' : ''}`}
              aria-pressed={minRating === r}
            >
              {r === 0 ? 'Any' : (
                <>
                  {r}
                  <Icon name="star" filled className="h-3 w-3" />+
                </>
              )}
            </button>
          ))}
        </div>
      </Section>

      {stores.length > 0 && (
        <Section title="Stores">
          <div className="space-y-1">
            {stores.map((store) => (
              <label
                key={store.slug}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <input
                  type="checkbox"
                  checked={selectedStores.includes(store.slug)}
                  onChange={() => toggleStore(store.slug)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800"
                />
                <StoreBadge slug={store.slug} name={store.name} size="sm" />
                <span className="ml-auto text-xs text-slate-400">{store.count}</span>
              </label>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
