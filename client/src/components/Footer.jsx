import { Link } from 'react-router-dom';
import { Logo } from './Navbar';
import { STORES } from '../utils/formatters';

const CATEGORY_LINKS = ['Electronics', 'Clothing & Footwear', 'Home & Kitchen', 'Beauty & Personal Care', 'Grocery & Pantry'];

export default function Footer() {
  return (
    <footer className="mt-20 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="container-page py-12">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Logo />
            <p className="mt-3 max-w-xs text-sm text-slate-500 dark:text-slate-400">
              Live price comparison across India’s biggest online stores. No sign-up, no sample data — only real listings.
            </p>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Browse</h4>
            <ul className="space-y-2 text-sm">
              {CATEGORY_LINKS.map((name) => (
                <li key={name}>
                  <Link
                    to={`/search?category=${encodeURIComponent(name)}`}
                    className="text-slate-500 transition-colors hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-300"
                  >
                    {name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Stores compared</h4>
            <ul className="space-y-2 text-sm text-slate-500 dark:text-slate-400">
              {Object.values(STORES).map((store) => (
                <li key={store.name} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: store.color }} />
                  {store.name}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Good to know</h4>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Prices are the listed product prices at the time we checked. Shipping, taxes, coupons and bank offers may
              differ by store — always confirm on the store page before buying.
            </p>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-2 border-t border-slate-100 pt-6 text-xs text-slate-400 dark:border-slate-800 sm:flex-row">
          <span>© {new Date().getFullYear()} PricePiler</span>
          <span>Not affiliated with Amazon, Flipkart or Myntra.</span>
        </div>
      </div>
    </footer>
  );
}
