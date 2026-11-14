import { FormEvent, useEffect, useState } from 'react';
import { apiService } from '../services/api';
import type { TokenStatus } from '../types';
import { errorMessage, newPasswordProblem } from '../utils/authRoutes';
import { usePasswordMinLength } from '../hooks/usePasswordMinLength';
import { AuthField, AuthLayout, AuthLoading, AuthMessage, AuthSubmitButton, TokenStatusMessage } from './AuthLayout';

interface SetupPageProps {
  token: string;
  onDone: () => Promise<void>;
}

/** Ersteinrichtung: legt den ersten Administrator über den Onboarding-Link an. */
export function SetupPage({ token, onDone }: SetupPageProps) {
  const minLength = usePasswordMinLength();
  const [status, setStatus] = useState<TokenStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    apiService.getSetupStatus(token)
      .then((res) => active && setStatus(res.status))
      .catch((err) => active && setLoadError(errorMessage(err)));
    return () => {
      active = false;
    };
  }, [token]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = newPasswordProblem(password, confirmation, minLength);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiService.completeSetup({ token, name: name.trim(), email: email.trim(), password });
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="OpenBills einrichten" subtitle={status === 'valid' ? 'Legen Sie das Administrator-Konto an.' : undefined}>
      {loadError ? (
        <AuthMessage kind="error">{loadError}</AuthMessage>
      ) : status === null ? (
        <AuthLoading />
      ) : status !== 'valid' ? (
        <TokenStatusMessage status={status} />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <AuthMessage kind="error">{error}</AuthMessage>}
          <AuthField label="Name" value={name} onChange={setName} autoComplete="name" autoFocus />
          <AuthField label="E-Mail" type="email" value={email} onChange={setEmail} autoComplete="username" inputMode="email" />
          <AuthField label={`Passwort (mind. ${minLength} Zeichen)`} type="password" value={password} onChange={setPassword} autoComplete="new-password" />
          <AuthField label="Passwort bestätigen" type="password" value={confirmation} onChange={setConfirmation} autoComplete="new-password" />
          <AuthSubmitButton busy={busy}>Konto anlegen</AuthSubmitButton>
        </form>
      )}
    </AuthLayout>
  );
}
