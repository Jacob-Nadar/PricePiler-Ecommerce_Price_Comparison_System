import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { productId, bestOfferPerStore } from '../utils/formatters';
import { accountApi } from '../services/api';
import { useAuth } from './AuthContext';

const AppContext = createContext(null);

const WATCHLIST_KEY = 'pp-watchlist';
const RECENT_KEY = 'pp-recent-searches';
const THEME_KEY = 'pp-theme';
const MAX_RECENT = 8;

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch {
    /* storage may be unavailable (private mode); the app still works without it */
  }
}

// Compact snapshot of a product for the browser-only (logged-out) watchlist.
function snapshot(product) {
  const best = product.bestOffer;
  const perStore = [...bestOfferPerStore(product.offers || []).values()];
  return {
    id: productId(product),
    name: product.name,
    brand: product.brand || '',
    imageUrl: product.imageUrl || best?.imageUrl || '',
    specifications: product.specifications || {},
    savedPrice: best?.price ?? null,
    lastPrice: best?.price ?? null,
    lastStore: best?.storeName || '',
    lastUrl: best?.productUrl || '',
    offers: perStore.map(({ storeSlug, storeName, productUrl, price, availability, title }) => ({
      storeSlug,
      storeName,
      productUrl,
      price,
      availability,
      title,
    })),
    savedAt: new Date().toISOString(),
    lastCheckedAt: new Date().toISOString(),
  };
}

// A saved product from the server, in the same shape as the local snapshot.
function fromServer(item) {
  const best = item.bestOffer;
  return {
    id: item.clientKey || `db-${item.productId}`,
    productId: item.productId,
    server: true,
    name: item.name,
    brand: item.brand || '',
    imageUrl: item.imageUrl || '',
    specifications: item.specifications || {},
    savedPrice: null,
    lastPrice: best?.price ?? null,
    lastStore: best?.storeName || '',
    lastUrl: best?.productUrl || '',
    lowestRecorded: item.lowestRecorded,
    offers: item.offers || [],
    savedAt: item.savedAt,
    lastCheckedAt: item.lastChecked,
  };
}

export function AppProvider({ children }) {
  const { user } = useAuth();
  const [theme, setTheme] = useState(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  );
  const [localWatchlist, setLocalWatchlist] = useState(() => readStorage(WATCHLIST_KEY, []));
  const [serverWatchlist, setServerWatchlist] = useState([]);
  const [recentSearches, setRecentSearches] = useState(() => readStorage(RECENT_KEY, []));
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    writeStorage(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => writeStorage(WATCHLIST_KEY, localWatchlist), [localWatchlist]);
  useEffect(() => writeStorage(RECENT_KEY, recentSearches), [recentSearches]);

  // Keep tabs in sync when the local watchlist changes in another window.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === WATCHLIST_KEY) setLocalWatchlist(readStorage(WATCHLIST_KEY, []));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const dismissToast = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    (message, { type = 'success', duration = 3200 } = {}) => {
      const id = ++toastId.current;
      setToasts((list) => [...list.slice(-3), { id, message, type }]);
      setTimeout(() => dismissToast(id), duration);
    },
    [dismissToast]
  );

  const reloadSaved = useCallback(async () => {
    if (!user) return;
    try {
      const result = await accountApi.saved();
      setServerWatchlist(result.items.map(fromServer));
    } catch {
      /* keep what we have; the dashboard shows its own errors */
    }
  }, [user]);

  // On sign-in: move anything saved in this browser into the account, then load it.
  useEffect(() => {
    if (!user) {
      setServerWatchlist([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const pending = readStorage(WATCHLIST_KEY, []);
      let moved = 0;
      for (const item of pending) {
        try {
          await accountApi.save({ ...item, offers: item.offers || [] }, item.id);
          moved++;
        } catch {
          /* leave it in local storage to retry next time */
        }
      }
      if (moved && !cancelled) {
        setLocalWatchlist([]);
        toast(`Moved ${moved} saved product${moved === 1 ? '' : 's'} to your account`);
      }
      if (!cancelled) await reloadSaved();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const watchlist = user ? serverWatchlist : localWatchlist;

  const isSaved = useCallback((product) => watchlist.some((item) => item.id === productId(product)), [watchlist]);

  const toggleSaved = useCallback(
    async (product) => {
      const id = productId(product);
      const existing = watchlist.find((item) => item.id === id);
      if (user) {
        try {
          if (existing) {
            setServerWatchlist((list) => list.filter((item) => item.id !== id));
            await accountApi.unsave(existing.productId);
            toast('Removed from your watchlist', { type: 'info' });
          } else {
            setServerWatchlist((list) => [{ ...snapshot(product), server: true }, ...list]);
            await accountApi.save(product, id);
            toast('Saved — we’ll check its price regularly');
          }
        } catch (err) {
          toast(err.message, { type: 'error' });
        }
        reloadSaved();
        return;
      }
      if (existing) {
        setLocalWatchlist((list) => list.filter((item) => item.id !== id));
        toast('Removed from your watchlist', { type: 'info' });
      } else {
        setLocalWatchlist((list) => [snapshot(product), ...list.filter((item) => item.id !== id)]);
        toast('Saved on this device — log in to get email price alerts');
      }
    },
    [watchlist, user, toast, reloadSaved]
  );

  const updateSaved = useCallback(
    (id, changes) => {
      const apply = (list) => list.map((item) => (item.id === id ? { ...item, ...changes } : item));
      if (user) setServerWatchlist(apply);
      else setLocalWatchlist(apply);
    },
    [user]
  );

  const removeSaved = useCallback(
    async (id) => {
      if (user) {
        const item = serverWatchlist.find((i) => i.id === id);
        setServerWatchlist((list) => list.filter((i) => i.id !== id));
        if (item) await accountApi.unsave(item.productId).catch((err) => toast(err.message, { type: 'error' }));
        return;
      }
      setLocalWatchlist((list) => list.filter((item) => item.id !== id));
    },
    [user, serverWatchlist, toast]
  );

  const addRecentSearch = useCallback((query) => {
    const q = String(query || '').trim();
    if (!q) return;
    setRecentSearches((list) => [q, ...list.filter((item) => item.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT));
  }, []);

  const clearRecentSearches = useCallback(() => setRecentSearches([]), []);

  const value = useMemo(
    () => ({
      theme,
      toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
      watchlist,
      isSaved,
      toggleSaved,
      updateSaved,
      removeSaved,
      reloadSaved,
      recentSearches,
      addRecentSearch,
      clearRecentSearches,
      toasts,
      toast,
      dismissToast,
    }),
    [theme, watchlist, isSaved, toggleSaved, updateSaved, removeSaved, reloadSaved, recentSearches, addRecentSearch, clearRecentSearches, toasts, toast, dismissToast]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
