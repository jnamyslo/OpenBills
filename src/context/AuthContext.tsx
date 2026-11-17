import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { apiService, AuthRequiredError, AUTH_REQUIRED_EVENT } from '../services/api';
import type { AuthUser } from '../types';
import { isAdmin } from '../utils/authRoutes';

export type AuthStatus = 'loading' | 'anonymous' | 'mfa' | 'authenticated';

interface AuthContextType {
  user: AuthUser | null;
  status: AuthStatus;
  login(email: string, password: string): Promise<void>;
  verifyTotp(code: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  /** Einrichtungsassistent als abgeschlossen/übersprungen markieren (false = erneut starten). */
  setOnboardingCompleted(completed: boolean): Promise<void>;
  /** true, solange seit dem letzten aktiven Login noch keine Demo-Tour gestartet wurde (nur Demo-Instanz). */
  freshLogin: boolean;
  /** true, wenn die Tour ausdrücklich angefordert wurde (Benutzermenü oder nach der Ersteinrichtung). */
  tourRequested: boolean;
  /** Setzt freshLogin und tourRequested zurück. */
  consumeFreshLogin(): void;
  /** Tour erneut starten (Benutzermenü). */
  requestDemoTour(): void;
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
  const [freshLogin, setFreshLogin] = useState(false);
  const [tourRequested, setTourRequested] = useState(false);
  // Erstes Onboarding dieses Admins: danach läuft einmalig die Tour (nicht beim erneuten Start des Assistenten).
  const tourAfterOnboarding = useRef(false);
  const trackFirstOnboarding = (me: AuthUser) => {
    const first = !me.isOperator && !me.onboardingCompleted;
    tourAfterOnboarding.current = first && isAdmin(me);
    // Normale Benutzer haben keinen Assistenten: die Tour startet direkt.
    if (first && !isAdmin(me)) setTourRequested(true);
  };

  const refresh = useCallback(async () => {
    try {
      const { user: me } = await apiService.getMe();
      trackFirstOnboarding(me);
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
    trackFirstOnboarding(result.user);
    setUser(result.user);
    setStatus('authenticated');
    setFreshLogin(true);
  }, []);

  const verifyTotp = useCallback(async (code: string) => {
    try {
      const { user: me } = await apiService.loginTotp(code);
      trackFirstOnboarding(me);
      setUser(me);
      setStatus('authenticated');
      setFreshLogin(true);
    } catch (error) {
      // Pending-Session abgelaufen: Status neu laden, damit wieder das Login-Formular erscheint.
      if ((error as { code?: string }).code === 'MFA_NOT_PENDING') await refresh();
      throw error;
    }
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await apiService.logout();
    } finally {
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  const setOnboardingCompleted = useCallback(async (completed: boolean) => {
    const { user: me } = await apiService.setOnboardingCompleted(completed);
    setUser(me);
    if (completed && tourAfterOnboarding.current) {
      tourAfterOnboarding.current = false;
      setTourRequested(true);
    }
  }, []);

  const consumeFreshLogin = useCallback(() => {
    setFreshLogin(false);
    setTourRequested(false);
  }, []);
  const requestDemoTour = useCallback(() => setTourRequested(true), []);

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
    () => ({ user, status, login, verifyTotp, logout, refresh, setOnboardingCompleted, freshLogin, tourRequested, consumeFreshLogin, requestDemoTour }),
    [user, status, login, verifyTotp, logout, refresh, setOnboardingCompleted, freshLogin, tourRequested, consumeFreshLogin, requestDemoTour]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
