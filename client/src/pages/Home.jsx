import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import SearchForm from '../components/SearchForm';
import UrlExtractor from '../components/UrlExtractor';
import Icon from '../components/Icon';
import { ProductImage } from '../components/ui';
import { useApp } from '../context/AppContext';
import { formatPriceINR, STORES } from '../utils/formatters';

const CATEGORIES = [
  { name: 'Electronics', icon: 'cpu', desc: 'Phones, laptops, audio' },
  { name: 'Clothing & Footwear', icon: 'shirt', desc: 'T-shirts, jeans, shoes' },
  { name: 'Home & Kitchen', icon: 'home', desc: 'Cookware, bedding, decor' },
  { name: 'Beauty & Personal Care', icon: 'droplet', desc: 'Skincare, haircare' },
  { name: 'Grocery & Pantry', icon: 'cart', desc: 'Rice, atta, oil, coffee' },
  { name: 'Sports & Fitness', icon: 'dumbbell', desc: 'Yoga mats, dumbbells' },
  { name: 'Books & Stationery', icon: 'book', desc: 'Books, notebooks, pens' },
  { name: 'Toys & Games', icon: 'gamepad', desc: 'Blocks, board games' },
  { name: 'Baby & Kids', icon: 'baby', desc: 'Diapers, baby care' },
  { name: 'Pet Supplies', icon: 'paw', desc: 'Pet food & toys' },
];

const TRENDING = ['iPhone 15', 'boAt Airdopes', 'running shoes', 'basmati rice', 'air fryer', 'sunscreen'];

const STEPS = [
  { icon: 'search', title: 'Search or paste a link', text: 'Type any product or drop in a link from Amazon, Flipkart or Myntra.' },
  { icon: 'scan', title: 'We check every store live', text: 'Real listings, prices, ratings and stock — fetched right now, never sample data.' },
  { icon: 'tag', title: 'Buy at the best price', text: 'See the cheapest in-stock offer, your savings and how the price has moved.' },
];

const IDENTITY_SPECS = ['ram', 'storage', 'ssd', 'size', 'quantity', 'packOf'];

function SectionHeading({ eyebrow, title, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2 className="mt-2 text-xl font-semibold text-slate-900 dark:text-white sm:text-2xl">{title}</h2>
      </div>
      {children}
    </div>
  );
}

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
      <section className="relative overflow-hidden border-b border-slate-200 dark:border-slate-800">
        <div className="pointer-events-none absolute inset-0 tech-grid [mask-image:radial-gradient(ellipse_70%_65%_at_50%_0%,black,transparent)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_55%_100%_at_50%_0%,rgb(18_165_124/0.10),transparent)] dark:bg-[radial-gradient(ellipse_55%_100%_at_50%_0%,rgb(44_191_146/0.12),transparent)]" />

        <div className="container-page relative pb-14 pt-16 sm:pb-20 sm:pt-24">
          <div className="mx-auto max-w-3xl text-center animate-slide-up">
            <span className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-50" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
              </span>
              Live prices · {Object.keys(STORES).length} stores
            </span>
            <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.05] text-slate-900 dark:text-white sm:text-6xl">
              Stop overpaying.
              <span className="block text-brand-700 dark:text-brand-400">Compare in seconds.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-balance text-[15px] leading-relaxed text-slate-500 dark:text-slate-400 sm:text-base">
              One search checks Amazon India, Flipkart and Myntra together — and shows you the lowest in-stock price,
              how much you save and how the price has changed.
            </p>
          </div>

          <div className="mx-auto mt-10 max-w-3xl animate-slide-up [animation-delay:80ms]">
            <div className="card p-1.5 shadow-lift">
              <div className="flex gap-1 rounded-lg bg-slate-100/80 p-1 dark:bg-slate-800/60" role="tablist">
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
                    className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-[13px] font-semibold transition-all ${
                      mode === tab.id
                        ? 'bg-white text-slate-900 shadow-soft dark:bg-slate-900 dark:text-white'
                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    <Icon name={tab.icon} className="h-4 w-4" strokeWidth={1.8} />
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
                  <span className="eyebrow mr-1">
                    <Icon name="clock" className="h-3.5 w-3.5" strokeWidth={1.75} /> Recent
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
                  <span className="eyebrow mr-1">
                    <Icon name="trendingUp" className="h-3.5 w-3.5" strokeWidth={1.75} /> Try
                  </span>
                  {TRENDING.map((q) => (
                    <button key={q} type="button" className="chip" onClick={() => quickSearch(q)}>
                      {q}
                    </button>
                  ))}
                </>
              )}
            </div>

            <p className="mt-7 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              Live listings · Price history · Stock alerts
            </p>
          </div>
        </div>
      </section>

      {watchlist.length > 0 && (
        <section className="container-page mt-14">
          <SectionHeading eyebrow="Watchlist" title="Back on your radar">
            <Link to="/saved" className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-700 hover:text-brand-800 dark:text-brand-400 dark:hover:text-brand-300">
              View all <Icon name="arrowRight" className="h-4 w-4" />
            </Link>
          </SectionHeading>
          <div className="scrollbar-none -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
            {watchlist.slice(0, 6).map((item) => (
              <Link
                key={item.id}
                to={`/product/live?${new URLSearchParams({ name: item.name, ...(item.brand ? { brand: item.brand } : {}) })}`}
                className="card group flex w-64 shrink-0 gap-3 p-3 transition-colors hover:border-slate-300 dark:hover:border-slate-700"
              >
                <div className="h-16 w-16 shrink-0 rounded-md border border-slate-100 bg-white p-1.5 dark:border-slate-800 dark:bg-slate-800">
                  <ProductImage src={item.imageUrl} alt={item.name} className="h-full w-full" />
                </div>
                <div className="min-w-0">
                  <p className="line-clamp-2 text-[13px] font-medium leading-snug text-slate-800 group-hover:text-brand-700 dark:text-slate-200 dark:group-hover:text-brand-300">
                    {item.name}
                  </p>
                  <p className="num mt-1.5 text-sm font-semibold text-slate-900 dark:text-white">{formatPriceINR(item.lastPrice)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="container-page mt-16">
        <SectionHeading eyebrow="Catalog" title="Browse by category" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {CATEGORIES.map((c, i) => (
            <button
              key={c.name}
              type="button"
              onClick={() => navigate(`/search?category=${encodeURIComponent(c.name)}`)}
              className="card group flex h-[112px] flex-col justify-between p-4 text-left transition-colors duration-200 hover:border-slate-300 hover:shadow-lift dark:hover:border-slate-700 animate-slide-up"
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <div className="flex items-start justify-between">
                <span className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600 transition-colors group-hover:border-brand-200 group-hover:text-brand-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 dark:group-hover:border-brand-500/40 dark:group-hover:text-brand-400">
                  <Icon name={c.icon} className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <span className="font-mono text-[10px] text-slate-300 dark:text-slate-600">
                  {String(i + 1).padStart(2, '0')}
                </span>
              </div>
              <div>
                <div className="text-[13px] font-semibold leading-tight text-slate-900 dark:text-white">{c.name}</div>
                <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{c.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="container-page mt-16">
        <SectionHeading eyebrow="How it works" title="Three steps, no guesswork" />
        <div className="card overflow-hidden">
          <div className="grid divide-y divide-slate-200 dark:divide-slate-800 md:grid-cols-3 md:divide-x md:divide-y-0">
            {STEPS.map((step, i) => (
              <div key={step.title} className="p-6 sm:p-7">
                <div className="flex items-center justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                    <Icon name={step.icon} className="h-4 w-4" strokeWidth={1.75} />
                  </span>
                  <span className="font-mono text-[11px] tracking-[0.14em] text-slate-400 dark:text-slate-500">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>
                <h3 className="mt-5 text-[15px] font-semibold text-slate-900 dark:text-white">{step.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
