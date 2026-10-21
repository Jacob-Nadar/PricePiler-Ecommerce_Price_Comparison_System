import { useState } from 'react';
import Icon from './Icon';

const STORE_URL_PATTERN = /^https?:\/\/(?:[\w-]+\.)*(?:amazon\.in|amzn\.in|amzn\.to|flipkart\.com|myntra\.com)\//i;

export default function SearchForm({ onSearch, onUrlPasted, loading = false, autoFocus = false }) {
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    const value = name.trim();
    if (!value) return;
    if (STORE_URL_PATTERN.test(value) && onUrlPasted) {
      onUrlPasted(value);
      return;
    }
    onSearch({ name: value, brand: brand.trim(), model: model.trim() });
  };

  const handleChange = (e) => {
    const value = e.target.value;
    // A pasted store link belongs in the link extractor, not a keyword search.
    if (STORE_URL_PATTERN.test(value.trim()) && onUrlPasted) {
      onUrlPasted(value.trim());
      setName('');
      return;
    }
    setName(value);
  };

  return (
    <form onSubmit={handleSubmit} role="search">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            className="input h-14 rounded-2xl pl-12 text-base"
            placeholder="Search a product — e.g. iPhone 15, running shoes, basmati rice"
            value={name}
            onChange={handleChange}
            aria-label="Product name"
            autoFocus={autoFocus}
            required
          />
        </div>
        <button type="submit" className="btn-primary h-14 rounded-2xl px-7 text-base" disabled={loading || !name.trim()}>
          Compare prices
          <Icon name="arrowRight" className="h-4 w-4" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-300"
        aria-expanded={showAdvanced}
      >
        <Icon name="chevronDown" className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
        Exact product (brand &amp; model)
      </button>

      {showAdvanced && (
        <div className="mt-3 grid animate-slide-up grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="sf-brand">Brand</label>
            <input
              id="sf-brand"
              className="input"
              placeholder="Apple, Samsung, Puma…"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="sf-model">Model</label>
            <input
              id="sf-model"
              className="input"
              placeholder="iPhone 15, Galaxy S24, Velocity Nitro…"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 sm:col-span-2">
            Adding a brand or model finds that exact product at every store and compares only matching listings.
          </p>
        </div>
      )}
    </form>
  );
}
