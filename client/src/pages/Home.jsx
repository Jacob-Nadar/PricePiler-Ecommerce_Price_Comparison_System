import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import SearchForm from '../components/SearchForm';
import UrlExtractor from '../components/UrlExtractor';
import Icon from '../components/Icon';
import { ProductImage } from '../components/ui';
import { useApp } from '../context/AppContext';
import { formatPriceINR, STORES } from '../utils/formatters';

const CATEGORIES = [
  { name: 'Electronics', icon: '🎧', desc: 'Phones, laptops, audio', tint: 'from-sky-500/10 to-indigo-500/10' },
  { name: 'Clothing & Footwear', icon: '👟', desc: 'T-shirts, jeans, shoes', tint: 'from-pink-500/10 to-rose-500/10' },
  { name: 'Home & Kitchen', icon: '🍳', desc: 'Cookware, bedding, decor', tint: 'from-amber-500/10 to-orange-500/10' },
  { name: 'Beauty & Personal Care', icon: '🧴', desc: 'Skincare, haircare', tint: 'from-fuchsia-500/10 to-purple-500/10' },
  { name: 'Grocery & Pantry', icon: '🛒', desc: 'Rice, atta, oil, coffee', tint: 'from-emerald-500/10 to-lime-500/10' },
  { name: 'Sports & Fitness', icon: '🏋️', desc: 'Yoga mats, dumbbells', tint: 'from-teal-500/10 to-cyan-500/10' },
  { name: 'Books & Stationery', icon: '📚', desc: 'Books, notebooks, pens', tint: 'from-yellow-500/10 to-amber-500/10' },
  { name: 'Toys & Games', icon: '🧸', desc: 'Blocks, board games', tint: 'from-red-500/10 to-pink-500/10' },
  { name: 'Baby & Kids', icon: '🍼', desc: 'Diapers, baby care', tint: 'from-blue-500/10 to-sky-500/10' },
  { name: 'Pet Supplies', icon: '🐾', desc: 'Pet food & toys', tint: 'from-orange-500/10 to-amber-500/10' },
];

const TRENDING = ['iPhone 15', 'boAt Airdopes', 'running shoes', 'basmati rice', 'air fryer', 'sunscreen'];

const STEPS = [
  { icon: 'search', title: 'Search or paste a link', text: 'Type any product or drop in a link from Amazon, Flipkart or Myntra.' },
  { icon: 'zap', title: 'We check every store live', text: 'Real listings, prices, ratings and stock — fetched right now, never sample data.' },
  { icon: 'tag', title: 'Buy at the best price', text: 'See the cheapest in-stock offer, your savings and how the price has moved.' },
];

const IDENTITY_SPECS = ['ram', 'storage', 'ssd', 'size', 'quantity', 'packOf'];

export default function Home() {
  const navigate = useNavigate();
  const { recentSearches, addRecentSearch, clearRecentSearches, watchlist } = useApp();
  const [mode, setMode] = useState('search');
  const [pastedUrl, setPastedUrl] = useState('');

  const goToSearch = (params) => navigate(`/search?${params.toString()}`);

  const handleManualSearch = ({ name, brand, model }) => {
    const params = new URLSearchParams({ q: name });
    if (brand) params.set('brand', brand);
    if (model) params.set('model', model);
    addRecentSearch(name);
    goToSearch(params);
  };

  const handleExtracted = (product) => {
    const params = new URLSearchParams({ q: product.name });
    if (product.brand) params.set('brand', product.brand);
    if (product.model) params.set('model', product.model);
    // Only variant-defining specs narrow the match; colour or material wording differs by store.
    for (const key of IDENTITY_SPECS) {
      const value = product.specifications?.[key];
      if (value) params.set(`spec_${key}`, value);
    }
    params.set('from', 'link');
    goToSearch(params);
  };

  const quickSearch = (q) => {
    addRecentSearch(q);
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <div>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgb(99_102_241/0.18),transparent)] dark:bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgb(99_102_241/0.25),transparent)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgb(148_163_184/0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgb(148_163_184/0.08)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]" />

        <div className="container-page relative pb-12 pt-14 sm:pb-16 sm:pt-20">
          <div className="mx-auto max-w-3xl text-center animate-slide-up">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/80 px-3 py-1 text-xs font-semibold text-brand-700 shadow-sm backdrop-blur dark:border-brand-500/30 dark:bg-slate-900/80 dark:text-brand-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-deal-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-deal-500" />
              </span>
              Live prices from {Object.keys(STORES).length} stores
            </span>
            <h1 className="mt-5 text-balance text-4xl font-extrabold text-slate-900 dark:text-white sm:text-6xl">
              Stop overpaying.{' '}
              <span className="bg-gradient-to-r from-brand-600 via-violet-600 to-fuchsia-500 bg-clip-text text-transparent">
                Compare in seconds.
              </span>
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-balance text-base text-slate-600 dark:text-slate-300 sm:text-lg">
              One search checks Amazon India, Flipkart and Myntra together — and shows you the lowest in-stock price,
              how much you save and how the price has changed.
            </p>
          </div>

          <div className="mx-auto mt-9 max-w-3xl animate-slide-up [animation-delay:80ms]">
            <div className="card p-2 shadow-glow">
              <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/80" role="tablist">
                {[
                  { id: 'search', icon: 'search', label: 'Search products' },
                  { id: 'url', icon: 'link', label: 'Paste a link' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={mode === tab.id}
                    onClick={() => setMode(tab.id)}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-all ${
                      mode === tab.id
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    <Icon name={tab.icon} className="h-4 w-4" />
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="p-3 sm:p-4">
                {mode === 'search' ? (
                  <SearchForm
                    onSearch={handleManualSearch}
                    onUrlPasted={(url) => {
                      setPastedUrl(url);
                      setMode('url');
                    }}
                    autoFocus
                  />
                ) : (
                  <UrlExtractor onExtracted={handleExtracted} initialUrl={pastedUrl} />
                )}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {recentSearches.length > 0 ? (
                <>
                  <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <Icon name="clock" className="h-3.5 w-3.5" /> Recent
                  </span>
                  {recentSearches.slice(0, 5).map((q) => (
                    <button key={q} type="button" className="chip" onClick={() => quickSearch(q)}>
                      {q}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={clearRecentSearches}
                    className="text-xs font-medium text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline dark:hover:text-slate-200"
                  >
                    Clear
                  </button>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <Icon name="trendingUp" className="h-3.5 w-3.5" /> Try
                  </span>
                  {TRENDING.map((q) => (
                    <button key={q} type="button" className="chip" onClick={() => quickSearch(q)}>
                      {q}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {watchlist.length > 0 && (
        <section className="container-page mt-4">
          <div className="mb-4 flex items-end justify-between">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Your watchlist</h2>
            <Link to="/saved" className="flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300">
              View all <Icon name="arrowRight" className="h-4 w-4" />
            </Link>
          </div>
          <div className="scrollbar-none -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
            {watchlist.slice(0, 6).map((item) => (
              <Link
                key={item.id}
                to={`/product/live?${new URLSearchParams({ name: item.name, ...(item.brand ? { brand: item.brand } : {}) })}`}
                className="card group flex w-64 shrink-0 gap-3 p-3 transition-all hover:-translate-y-0.5 hover:shadow-lift"
              >
                <div className="h-16 w-16 shrink-0 rounded-xl bg-white p-1.5 dark:bg-slate-800">
                  <ProductImage src={item.imageUrl} alt={item.name} className="h-full w-full" />
                </div>
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-medium text-slate-800 group-hover:text-brand-700 dark:text-slate-200 dark:group-hover:text-brand-300">
                    {item.name}
                  </p>
                  <p className="mt-1 text-sm font-bold text-slate-900 dark:text-white">{formatPriceINR(item.lastPrice)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="container-page mt-14">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Browse by category</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">We search several popular items in each category at once.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {CATEGORIES.map((c, i) => (
            <button
              key={c.name}
              type="button"
              onClick={() => navigate(`/search?category=${encodeURIComponent(c.name)}`)}
              className={`card group relative overflow-hidden p-4 text-left transition-all duration-300 hover:-translate-y-1 hover:border-brand-200 hover:shadow-lift animate-slide-up dark:hover:border-brand-500/40`}
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${c.tint} opacity-0 transition-opacity duration-300 group-hover:opacity-100`} />
              <div className="relative">
                <div className="text-3xl transition-transform duration-300 group-hover:scale-110">{c.icon}</div>
                <div className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">{c.name}</div>
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{c.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="container-page mt-16">
        <div className="card overflow-hidden">
          <div className="grid divide-y divide-slate-100 dark:divide-slate-800 md:grid-cols-3 md:divide-x md:divide-y-0">
            {STEPS.map((step, i) => (
              <div key={step.title} className="p-6 sm:p-8">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
                    <Icon name={step.icon} />
                  </span>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Step {i + 1}</span>
                </div>
                <h3 className="mt-4 font-bold text-slate-900 dark:text-white">{step.title}</h3>
                <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
