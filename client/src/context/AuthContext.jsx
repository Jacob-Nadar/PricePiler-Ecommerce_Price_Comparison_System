import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // 'available' | 'unavailable' (no database) — lets the UI explain why accounts are off.
  const [accounts, setAccounts] = useState('available');

  const refresh = useCallback(async () => {
    try {
      const result = await authApi.me();
      setUser(result.user);
      setAccounts('available');
    } catch (err) {
      setUser(null);
      setAccounts(err.status === 503 ? 'unavailable' : 'available');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(() => ({ user, setUser, loading, refresh, logout, accounts }), [user, loading, refresh, logout, accounts]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
