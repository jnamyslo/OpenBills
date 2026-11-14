import { ReactNode } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import type { TokenStatus } from '../types';

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

/** Zentrierte Karte für alle Seiten ohne Anmeldung (Login, Setup, Einladung, Reset). */
export function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 flex items-center justify-center px-4 py-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="auth-blob auth-blob-1" />
        <div className="auth-blob auth-blob-2" />
        <div className="auth-blob auth-blob-3" />
        <div className="auth-grid absolute inset-0" />
      </div>
      <div className="auth-enter relative w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-lg shadow-blue-950/50 ring-1 ring-white/20">
            <img src="/openbills-icon.png" alt="" className="h-8 w-8" />
          </span>
          <span className="text-2xl font-bold text-white tracking-tight">OpenBills</span>
        </div>
        <div className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl shadow-blue-950/50 ring-1 ring-white/20 p-6 sm:p-8">
          <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-gray-600">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

interface AuthFieldProps {
  label: string;
  type?: string;
  value: string;
  onChange?: (value: string) => void;
  autoComplete?: string;
  autoFocus?: boolean;
  readOnly?: boolean;
  inputMode?: 'text' | 'numeric' | 'email';
  placeholder?: string;
}

export function AuthField({ label, type = 'text', value, onChange, autoComplete, autoFocus, readOnly, inputMode, placeholder }: AuthFieldProps) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-700 mb-1">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        readOnly={readOnly}
        inputMode={inputMode}
        placeholder={placeholder}
        required={!readOnly}
        className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${readOnly ? 'bg-gray-100 text-gray-600' : ''}`}
      />
    </label>
  );
}

export function AuthMessage({ kind, children }: { kind: 'error' | 'success'; children: ReactNode }) {
  const Icon = kind === 'error' ? AlertCircle : CheckCircle2;
  const colors = kind === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700';
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${colors}`}>
      <Icon className="h-4 w-4 mt-0.5 flex-shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function AuthSubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {busy ? 'Bitte warten…' : children}
    </button>
  );
}

export function AuthLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="text-sm text-blue-600 hover:text-blue-800 hover:underline">
      {children}
    </a>
  );
}

export function AuthLoading() {
  return (
    <div className="flex justify-center py-6">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
  );
}

const TOKEN_STATUS_MESSAGES: Record<Exclude<TokenStatus, 'valid'>, string> = {
  expired: 'Dieser Link ist abgelaufen. Bitte fordern Sie einen neuen an.',
  used: 'Dieser Link wurde bereits verwendet.',
  invalid: 'Dieser Link ist ungültig.',
  done: 'OpenBills ist bereits eingerichtet. Bitte melden Sie sich an.',
};

/** Meldung für Links, die nicht (mehr) gültig sind – ohne Formularfelder. */
export function TokenStatusMessage({ status }: { status: Exclude<TokenStatus, 'valid'> }) {
  return (
    <div className="space-y-4">
      <AuthMessage kind={status === 'done' ? 'success' : 'error'}>{TOKEN_STATUS_MESSAGES[status]}</AuthMessage>
      <div className="text-center">
        <AuthLink href="#dashboard">Zur Anmeldung</AuthLink>
      </div>
    </div>
  );
}
