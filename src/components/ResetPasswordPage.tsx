import { FormEvent, useEffect, useState } from 'react';
import { apiService } from '../services/api';
import type { TokenStatus } from '../types';
import { errorMessage, newPasswordProblem } from '../utils/authRoutes';
import { AuthField, AuthLayout, AuthLoading, AuthMessage, AuthSubmitButton, TokenStatusMessage } from './AuthLayout';

interface ResetPasswordPageProps {
  token: string;
  onDone: () => Promise<void>;
}

/** Neues Passwort über einen Reset-Link setzen. Das Backend beendet alle Sessions – danach neu anmelden. */
export function ResetPasswordPage({ token, onDone }: ResetPasswordPageProps) {
  const [status, setStatus] = useState<TokenStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let active = true;
    apiService.getResetStatus(token)
      .then((res) => active && setStatus(res.status))
      .catch((err) => active && setLoadError(errorMessage(err)));
    return () => {
      active = false;
    };
  }, [token]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = newPasswordProblem(password, confirmation);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiService.resetPassword(token, password);
      setCompleted(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleContinue = async () => {
    setBusy(true);
    await onDone();
  };

  return (
    <AuthLayout title="Neues Passwort festlegen">
      {completed ? (
        <div className="space-y-4">
          <AuthMessage kind="success">Ihr Passwort wurde geändert. Bitte melden Sie sich mit dem neuen Passwort an.</AuthMessage>
          <button
            type="button"
            onClick={handleContinue}
            disabled={busy}
            className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-60"
          >
            Zur Anmeldung
          </button>
        </div>
      ) : loadError ? (
        <AuthMessage kind="error">{loadError}</AuthMessage>
      ) : status === null ? (
        <AuthLoading />
      ) : status !== 'valid' ? (
        <TokenStatusMessage status={status} />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <AuthMessage kind="error">{error}</AuthMessage>}
          <AuthField label="Neues Passwort (mind. 12 Zeichen)" type="password" value={password} onChange={setPassword} autoComplete="new-password" autoFocus />
          <AuthField label="Passwort bestätigen" type="password" value={confirmation} onChange={setConfirmation} autoComplete="new-password" />
          <AuthSubmitButton busy={busy}>Passwort speichern</AuthSubmitButton>
        </form>
      )}
    </AuthLayout>
  );
}
