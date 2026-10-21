import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Icon from './Icon';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

const NAV_LINKS = [
  { category: 'Electronics', label: 'Electronics' },
  { category: 'Clothing & Footwear', label: 'Fashion' },
  { category: 'Home & Kitchen', label: 'Home' },
  { category: 'Beauty & Personal Care', label: 'Beauty' },
  { category: 'Grocery & Pantry', label: 'Grocery' },
];

export function Logo({ className = '' }) {
  return (
    <Link to="/" className={`flex items-center gap-2 ${className}`} aria-label="PricePiler home">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 font-display text-lg font-extrabold text-white shadow-md shadow-brand-600/30">
        ₹
      </span>
      <span className="font-display text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">
        Price<span className="text-brand-600 dark:text-brand-400">Piler</span>
      </span>
    </Link>
  );
}

function UserMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname, location.search]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const initials = user.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const item = 'flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800';
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white shadow-sm ring-2 ring-white transition-transform hover:scale-105 dark:ring-slate-950"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        {initials}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-60 animate-slide-up rounded-2xl border border-slate-200 bg-white p-2 shadow-lift dark:border-slate-700 dark:bg-slate-900" role="menu">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{user.fullName}</p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
          </div>
          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
          <Link to="/dashboard" className={item} role="menuitem"><Icon name="chart" className="h-4 w-4" /> Dashboard</Link>
          {user.isAdmin && (
            <Link to="/admin" className={item} role="menuitem"><Icon name="shield" className="h-4 w-4" /> Admin panel</Link>
          )}
          <Link to="/dashboard?tab=price" className={item} role="menuitem"><Icon name="bell" className="h-4 w-4" /> Price alerts</Link>
          <Link to="/dashboard?tab=notifications" className={item} role="menuitem"><Icon name="clock" className="h-4 w-4" /> Notifications</Link>
          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
          <button type="button" onClick={onLogout} className={`${item} w-full text-rose-600 dark:text-rose-400`} role="menuitem">
            <Icon name="arrowLeft" className="h-4 w-4" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

export default function Navbar() {
  const { theme, toggleTheme, watchlist, toast } = useApp();
  const { user, logout } = useAuth();
  const handleLogout = async () => {
    await logout();
    toast('You have been logged out', { type: 'info' });
    navigate('/');
  };
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scrolled, setScrolled] = useState(false);
  const isHome = location.pathname === '/';

  useEffect(() => setMenuOpen(false), [location.pathname, location.search]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const submit = (e) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
    setQuery('');
  };

  const activeCategory =
    location.pathname === '/search' ? new URLSearchParams(location.search).get('category') : null;
  const linkClass = ({ isActive }) =>
    `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      isActive
        ? 'text-brand-700 dark:text-brand-300'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
    }`;

  return (
    <header
      className={`sticky top-0 z-40 border-b backdrop-blur-xl transition-all ${
        scrolled
          ? 'border-slate-200/80 bg-white/85 shadow-sm dark:border-slate-800 dark:bg-slate-950/85'
          : 'border-transparent bg-white/60 dark:bg-slate-950/60'
      }`}
    >
      <div className="container-page">
        <div className="flex h-16 items-center gap-4">
          <Logo />

          {!isHome && (
            <form onSubmit={submit} className="relative hidden max-w-md flex-1 md:block" role="search">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="input h-10 rounded-full pl-9"
                placeholder="Search any product…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search products"
              />
            </form>
          )}

          <nav className="ml-auto hidden items-center gap-0.5 lg:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                to={`/search?category=${encodeURIComponent(link.category)}`}
                className={linkClass({ isActive: activeCategory === link.category })}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1 lg:ml-2">
            <Link to="/saved" className="btn-icon relative" aria-label={`Watchlist (${watchlist.length})`} title="Watchlist">
              <Icon name="heart" />
              {watchlist.length > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-950">
                  {watchlist.length}
                </span>
              )}
            </Link>
            <button
              type="button"
              onClick={toggleTheme}
              className="btn-icon"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>
            {user ? (
              <UserMenu user={user} onLogout={handleLogout} />
            ) : (
              <div className="hidden items-center gap-1 sm:flex">
                <Link to="/login" className="btn-ghost px-3 py-2">Log in</Link>
                <Link to="/register" className="btn-primary px-3.5 py-2">Sign up</Link>
              </div>
            )}
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="btn-icon lg:hidden"
              aria-label="Toggle menu"
              aria-expanded={menuOpen}
            >
              <Icon name={menuOpen ? 'x' : 'menu'} />
            </button>
          </div>
        </div>
      </div>

      {menuOpen && (
        <div className="animate-slide-up border-t border-slate-200 bg-white px-4 pb-4 pt-3 dark:border-slate-800 dark:bg-slate-950 lg:hidden">
          <form onSubmit={submit} className="relative mb-3" role="search">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input rounded-full pl-9"
              placeholder="Search any product…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search products"
            />
          </form>
          <div className="grid grid-cols-2 gap-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                to={`/search?category=${encodeURIComponent(link.category)}`}
                className={linkClass({ isActive: activeCategory === link.category })}
              >
                {link.label}
              </Link>
            ))}
            <Link to="/saved" className={linkClass({ isActive: location.pathname === '/saved' })}>
              Watchlist
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            {user ? (
              <>
                <Link to="/dashboard" className="btn-secondary">Dashboard</Link>
                {user.isAdmin && <Link to="/admin" className="btn-secondary col-span-2">Admin panel</Link>}
                <button type="button" onClick={handleLogout} className="btn-ghost text-rose-600 dark:text-rose-400">Log out</button>
              </>
            ) : (
              <>
                <Link to="/login" className="btn-secondary">Log in</Link>
                <Link to="/register" className="btn-primary">Sign up</Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
