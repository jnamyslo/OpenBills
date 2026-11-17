import { FormEvent, useEffect, useState } from 'react';
import { apiService } from '../services/api';
import type { AuthRole, TokenStatus } from '../types';
import { errorMessage, newPasswordProblem } from '../utils/authRoutes';
import { usePasswordMinLength } from '../hooks/usePasswordMinLength';
import { AuthField, AuthLayout, AuthLoading, AuthMessage, AuthSubmitButton, TokenStatusMessage } from './AuthLayout';

interface AcceptInvitePageProps {
  token: string;
  onDone: () => Promise<void>;
}

const ROLE_LABELS: Record<AuthRole, string> = {
  admin: 'Administrator',
  user: 'Benutzer',
};

/** Einladung annehmen: Name und Passwort für das eingeladene Konto festlegen. */
export function AcceptInvitePage({ token, onDone }: AcceptInvitePageProps) {
  const minLength = usePasswordMinLength();
  const [status, setStatus] = useState<TokenStatus | null>(null);
  const [invite, setInvite] = useState<{ email: string; role?: AuthRole }>({ email: '' });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    apiService.getInvite(token)
      .then((res) => {
        if (!active) return;
        setInvite({ email: res.email ?? '', role: res.role });
        setStatus(res.status);
      })
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
      await apiService.acceptInvite(token, { name: name.trim(), password });
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const subtitle = status === 'valid' && invite.role
    ? `Sie wurden als ${ROLE_LABELS[invite.role]} zu OpenBills eingeladen.`
    : undefined;

  return (
    <AuthLayout title="Einladung annehmen" subtitle={subtitle}>
      {loadError ? (
        <AuthMessage kind="error">{loadError}</AuthMessage>
      ) : status === null ? (
        <AuthLoading />
      ) : status !== 'valid' ? (
        <TokenStatusMessage status={status} />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <AuthMessage kind="error">{error}</AuthMessage>}
          <AuthField label="E-Mail" type="email" value={invite.email} autoComplete="username" readOnly />
          <AuthField label="Name" value={name} onChange={setName} autoComplete="name" autoFocus />
          <AuthField label={`Passwort (mind. ${minLength} Zeichen)`} type="password" value={password} onChange={setPassword} autoComplete="new-password" />
          <AuthField label="Passwort bestätigen" type="password" value={confirmation} onChange={setConfirmation} autoComplete="new-password" />
          <AuthSubmitButton busy={busy}>Konto anlegen</AuthSubmitButton>
        </form>
      )}
    </AuthLayout>
  );
}
