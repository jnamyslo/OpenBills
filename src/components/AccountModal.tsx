import { Modal } from './Modal';
import { FormEvent, useState } from 'react';
import QRCode from 'qrcode';
import { useAuth } from '../context/AuthContext';
import { apiService } from '../services/api';
import { errorMessage, newPasswordProblem } from '../utils/authRoutes';
import { usePasswordMinLength } from '../hooks/usePasswordMinLength';
import { useDemo } from '../context/DemoContext';
import { DemoDisabledNotice } from './DemoDisabledNotice';
import { PasswordInput } from './PasswordInput';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TwoFactorStep = 'idle' | 'password' | 'code' | 'recovery' | 'disable';

const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-custom';
const buttonClass = 'px-4 py-2 rounded-md bg-primary-custom text-white hover:opacity-90 disabled:opacity-50';
const secondaryClass = 'px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50';

export function AccountModal({ isOpen, onClose }: AccountModalProps) {
  const minLength = usePasswordMinLength();
  const { demo } = useDemo();
  const { user, refresh } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  const [step, setStep] = useState<TwoFactorStep>('idle');
  const [tfPassword, setTfPassword] = useState('');
  const [tfCode, setTfCode] = useState('');
  const [secret, setSecret] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [tfError, setTfError] = useState('');
  const [tfBusy, setTfBusy] = useState(false);

  if (!isOpen || !user) return null;

  const resetTwoFactor = () => {
    setStep('idle');
    setTfPassword('');
    setTfCode('');
    setSecret('');
    setQrUrl('');
    setRecoveryCodes([]);
    setCopied(false);
    setTfError('');
  };

  const handleClose = () => {
    if (step === 'recovery') void refresh();
    resetTwoFactor();
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPwError('');
    setPwSuccess('');
    onClose();
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setPwError('');
    setPwSuccess('');
    const problem = newPasswordProblem(newPassword, confirmPassword, minLength);
    if (problem) {
      setPwError(problem);
      return;
    }
    setPwBusy(true);
    try {
      await apiService.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwSuccess('Passwort geändert. Alle anderen Sitzungen wurden beendet.');
    } catch (error) {
      setPwError(errorMessage(error));
    } finally {
      setPwBusy(false);
    }
  };

  const submitSetupPassword = async (event: FormEvent) => {
    event.preventDefault();
    setTfError('');
    setTfBusy(true);
    try {
      const result = await apiService.totpSetup(tfPassword);
      setQrUrl(await QRCode.toDataURL(result.otpauthUri));
      setSecret(result.secret);
      setTfPassword('');
      setStep('code');
    } catch (error) {
      setTfError(errorMessage(error));
    } finally {
      setTfBusy(false);
    }
  };

  const submitEnable = async (event: FormEvent) => {
    event.preventDefault();
    setTfError('');
    setTfBusy(true);
    try {
      const result = await apiService.totpEnable(tfCode.trim());
      setRecoveryCodes(result.recoveryCodes);
      setTfCode('');
      setSecret('');
      setQrUrl('');
      setStep('recovery');
    } catch (error) {
      setTfError(errorMessage(error));
    } finally {
      setTfBusy(false);
    }
  };

  const submitDisable = async (event: FormEvent) => {
    event.preventDefault();
    setTfError('');
    setTfBusy(true);
    try {
      await apiService.totpDisable(tfPassword, tfCode.trim());
      resetTwoFactor();
      await refresh();
    } catch (error) {
      setTfError(errorMessage(error));
    } finally {
      setTfBusy(false);
    }
  };

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const finishRecovery = async () => {
    resetTwoFactor();
    await refresh();
  };

  return (
    <Modal title="Konto" onClose={handleClose} size="lg" zClass="z-50">
        <div className="space-y-8">
          <div className="text-sm text-gray-600">
            <p className="font-medium text-gray-900">{user.name}</p>
            <p>{user.email}</p>
          </div>

          <DemoDisabledNotice />
          <fieldset disabled={demo} className="space-y-8 min-w-0">
          <section>
            <h4 className="text-base font-semibold text-gray-900 mb-3">Passwort ändern</h4>
            <form onSubmit={submitPassword} className="space-y-3">
              <label className="block text-sm text-gray-700">
                Aktuelles Passwort
                <PasswordInput autoComplete="current-password" required value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)} className={inputClass} wrapperClassName="mt-1" />
              </label>
              <label className="block text-sm text-gray-700">
                Neues Passwort
                <PasswordInput autoComplete="new-password" required value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)} className={inputClass} wrapperClassName="mt-1" />
              </label>
              <label className="block text-sm text-gray-700">
                Neues Passwort bestätigen
                <PasswordInput autoComplete="new-password" required value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)} className={inputClass} wrapperClassName="mt-1" />
              </label>
              {pwError && <p role="alert" className="text-sm text-red-600">{pwError}</p>}
              {pwSuccess && <p role="status" className="text-sm text-green-700">{pwSuccess}</p>}
              <button type="submit" disabled={pwBusy} className={buttonClass}>Passwort ändern</button>
            </form>
          </section>

          <section>
            <h4 className="text-base font-semibold text-gray-900 mb-3">Zwei-Faktor-Authentifizierung</h4>

            {step === 'idle' && !user.totpEnabled && (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">Die Zwei-Faktor-Authentifizierung ist nicht aktiv.</p>
                <button onClick={() => setStep('password')} className={buttonClass}>Einrichten</button>
              </div>
            )}

            {step === 'idle' && user.totpEnabled && (
              <div className="space-y-3">
                <p className="text-sm text-green-700">Die Zwei-Faktor-Authentifizierung ist aktiv.</p>
                <button onClick={() => setStep('disable')} className={secondaryClass}>Deaktivieren</button>
              </div>
            )}

            {step === 'password' && (
              <form onSubmit={submitSetupPassword} className="space-y-3">
                <p className="text-sm text-gray-600">Bitte bestätigen Sie zuerst Ihr aktuelles Passwort.</p>
                <PasswordInput autoComplete="current-password" required value={tfPassword}
                  onChange={(e) => setTfPassword(e.target.value)} className={inputClass} aria-label="Aktuelles Passwort" />
                {tfError && <p role="alert" className="text-sm text-red-600">{tfError}</p>}
                <div className="flex gap-2">
                  <button type="submit" disabled={tfBusy} className={buttonClass}>Weiter</button>
                  <button type="button" onClick={resetTwoFactor} className={secondaryClass}>Abbrechen</button>
                </div>
              </form>
            )}

            {step === 'code' && (
              <form onSubmit={submitEnable} className="space-y-3">
                <p className="text-sm text-gray-600">
                  Scannen Sie den QR-Code mit Ihrer Authenticator-App und geben Sie den angezeigten Code ein.
                </p>
                {qrUrl && <img src={qrUrl} alt="QR-Code für die Authenticator-App" className="mx-auto w-48 h-48" />}
                <p className="text-sm text-gray-600">
                  Oder geben Sie den Schlüssel manuell ein:{' '}
                  <code className="break-all font-mono text-gray-900">{secret}</code>
                </p>
                <input type="text" inputMode="numeric" autoComplete="one-time-code" required value={tfCode}
                  onChange={(e) => setTfCode(e.target.value)} className={inputClass} aria-label="Code aus der App" placeholder="6-stelliger Code" />
                {tfError && <p role="alert" className="text-sm text-red-600">{tfError}</p>}
                <div className="flex gap-2">
                  <button type="submit" disabled={tfBusy} className={buttonClass}>Aktivieren</button>
                  <button type="button" onClick={resetTwoFactor} className={secondaryClass}>Abbrechen</button>
                </div>
              </form>
            )}

            {step === 'recovery' && (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">
                  Bewahren Sie diese Wiederherstellungscodes sicher auf. Sie werden nur einmal angezeigt und jeder Code kann nur einmal verwendet werden.
                </p>
                <ul className="grid grid-cols-2 gap-2 p-3 bg-gray-50 rounded-md font-mono text-sm">
                  {recoveryCodes.map((code) => <li key={code}>{code}</li>)}
                </ul>
                <div className="flex gap-2">
                  <button onClick={copyCodes} className={secondaryClass}>{copied ? 'Kopiert' : 'Kopieren'}</button>
                  <button onClick={finishRecovery} className={buttonClass}>Ich habe die Codes gespeichert</button>
                </div>
              </div>
            )}

            {step === 'disable' && (
              <form onSubmit={submitDisable} className="space-y-3">
                <p className="text-sm text-gray-600">Zum Deaktivieren sind Ihr Passwort und ein aktueller Code erforderlich.</p>
                <PasswordInput autoComplete="current-password" required value={tfPassword}
                  onChange={(e) => setTfPassword(e.target.value)} className={inputClass} aria-label="Aktuelles Passwort" placeholder="Aktuelles Passwort" />
                <input type="text" inputMode="numeric" autoComplete="one-time-code" required value={tfCode}
                  onChange={(e) => setTfCode(e.target.value)} className={inputClass} aria-label="Code aus der App" placeholder="6-stelliger Code" />
                {tfError && <p role="alert" className="text-sm text-red-600">{tfError}</p>}
                <div className="flex gap-2">
                  <button type="submit" disabled={tfBusy} className={buttonClass}>Deaktivieren</button>
                  <button type="button" onClick={resetTwoFactor} className={secondaryClass}>Abbrechen</button>
                </div>
              </form>
            )}
          </section>
          </fieldset>
        </div>
    </Modal>
  );
}
