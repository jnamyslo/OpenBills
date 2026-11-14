import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { apiService, AuthRequiredError, AUTH_REQUIRED_EVENT } from '../services/api';
import type { AuthUser } from '../types';

export type AuthStatus = 'loading' | 'anonymous' | 'mfa' | 'authenticated';

interface AuthContextType {
  user: AuthUser | null;
  status: AuthStatus;
  login(email: string, password: string): Promise<void>;
  verifyTotp(code: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  const refresh = useCallback(async () => {
    try {
      const { user: me } = await apiService.getMe();
      setUser(me);
      setStatus('authenticated');
    } catch (error) {
      setUser(null);
      setStatus(error instanceof AuthRequiredError && error.code === 'MFA_REQUIRED' ? 'mfa' : 'anonymous');
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiService.login(email, password);
    if (result.mfaRequired || !result.user) {
      setUser(null);
      setStatus('mfa');
      return;
    }
    setUser(result.user);
    setStatus('authenticated');
  }, []);

  const verifyTotp = useCallback(async (code: string) => {
    const { user: me } = await apiService.loginTotp(code);
    setUser(me);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiService.logout();
    } finally {
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handleAuthRequired = (event: Event) => {
      const code = (event as CustomEvent<{ code?: string }>).detail?.code;
      setUser(null);
      setStatus(code === 'MFA_REQUIRED' ? 'mfa' : 'anonymous');
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
  }, []);

  const value = useMemo(
    () => ({ user, status, login, verifyTotp, logout, refresh }),
    [user, status, login, verifyTotp, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
