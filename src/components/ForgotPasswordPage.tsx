import { FormEvent, useState } from 'react';
import { apiService } from '../services/api';
import { errorMessage } from '../utils/authRoutes';
import { AuthField, AuthLayout, AuthLink, AuthMessage, AuthSubmitButton } from './AuthLayout';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiService.requestPasswordReset(email.trim());
      setSubmitted(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Passwort vergessen" subtitle={submitted ? undefined : 'Wir senden Ihnen einen Link zum Zurücksetzen Ihres Passworts.'}>
      {submitted ? (
        <div className="space-y-4">
          <AuthMessage kind="success">
            Falls ein Konto mit dieser E-Mail-Adresse existiert, haben wir einen Link zum Zurücksetzen gesendet.
            Der Link ist eine Stunde gültig. Falls keine E-Mail ankommt, wenden Sie sich an Ihren Administrator.
          </AuthMessage>
          <div className="text-center">
            <AuthLink href="#dashboard">Zur Anmeldung</AuthLink>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <AuthMessage kind="error">{error}</AuthMessage>}
          <AuthField label="E-Mail" type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus inputMode="email" />
          <AuthSubmitButton busy={busy}>Link anfordern</AuthSubmitButton>
          <div className="text-center">
            <AuthLink href="#dashboard">Zurück zur Anmeldung</AuthLink>
          </div>
        </form>
      )}
    </AuthLayout>
  );
}
