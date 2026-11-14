import { FormEvent, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../utils/authRoutes';
import { AuthField, AuthLayout, AuthLink, AuthMessage, AuthSubmitButton } from './AuthLayout';

export function LoginPage() {
  const { status, login, verifyTotp, logout } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err, 'Anmeldung fehlgeschlagen.'));
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await login(email.trim(), password);
      setPassword('');
    });
  };

  const handleTotp = (e: FormEvent) => {
    e.preventDefault();
    run(() => verifyTotp(code.trim()));
  };

  const handleCancel = () => {
    setCode('');
    run(logout);
  };

  if (status === 'mfa') {
    return (
      <AuthLayout
        title="Zwei-Faktor-Bestätigung"
        subtitle="Geben Sie den 6-stelligen Code aus Ihrer Authenticator-App oder einen Wiederherstellungscode (xxxx-xxxx) ein."
      >
        <form onSubmit={handleTotp} className="space-y-4">
          {error && <AuthMessage kind="error">{error}</AuthMessage>}
          <AuthField
            label="Code"
            value={code}
            onChange={setCode}
            autoComplete="one-time-code"
            autoFocus
            placeholder="123456"
          />
          <AuthSubmitButton busy={busy}>Bestätigen</AuthSubmitButton>
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy}
            className="w-full px-4 py-2 rounded-lg font-medium text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-60"
          >
            Abbrechen
          </button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Anmelden">
      <form onSubmit={handleLogin} className="space-y-4">
        {error && <AuthMessage kind="error">{error}</AuthMessage>}
        <AuthField label="E-Mail" type="email" value={email} onChange={setEmail} autoComplete="username" autoFocus inputMode="email" />
        <AuthField label="Passwort" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <AuthSubmitButton busy={busy}>Anmelden</AuthSubmitButton>
        <div className="text-center">
          <AuthLink href="#forgot-password">Passwort vergessen?</AuthLink>
        </div>
      </form>
    </AuthLayout>
  );
}
