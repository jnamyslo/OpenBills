import React, { useCallback, useEffect, useState } from 'react';
import { Users, Copy, UserPlus } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../utils/authRoutes';
import { ConfirmationModal } from './ConfirmationModal';
import { DemoDisabledNotice } from './DemoDisabledNotice';
import { useDemo } from '../context/DemoContext';
import type { AuthRole, AuthUser } from '../types';

type Operator = { active: boolean; lastLoginAt: string | null };

interface PendingAction {
  title: string;
  message: string;
  confirmText: string;
  run: () => Promise<void>;
}

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleString('de-DE') : 'nie');
const isLocked = (u: AuthUser) => Boolean(u.lockedUntil && new Date(u.lockedUntil) > new Date());

function LinkBox({ title, link, emailed }: { title: string; link: string; emailed?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
      <p className="text-sm font-medium text-green-900">{title}</p>
      <div className="flex gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
        />
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          <Copy className="h-4 w-4 mr-1" />
          {copied ? 'Kopiert' : 'Kopieren'}
        </button>
      </div>
      {emailed !== undefined && (
        <p className="text-xs text-green-800">
          {emailed ? 'E-Mail wurde versendet' : 'Kein E-Mail-Versand konfiguriert – Link bitte selbst weitergeben'}
        </p>
      )}
    </div>
  );
}

export function UserManagement() {
  const { demo } = useDemo();
  const { user: me, refresh } = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [operator, setOperator] = useState<Operator | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [linkInfo, setLinkInfo] = useState<{ title: string; link: string; emailed?: boolean } | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AuthRole>('user');

  const load = useCallback(async () => {
    try {
      const result = await apiService.getUsers();
      setUsers(result.users);
      setOperator(result.operator);
    } catch (e) {
      setError(errorMessage(e, 'Nutzer konnten nicht geladen werden.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await action();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const invite = () => {
    const email = inviteEmail.trim();
    if (!email) return;
    setLinkInfo(null);
    void run(async () => {
      const { link, emailed } = await apiService.inviteUser(email, inviteRole);
      setLinkInfo({ title: `Einladungslink für ${email}`, link, emailed });
      setInviteEmail('');
    });
  };

  const changeRole = (u: AuthUser, role: AuthRole) => {
    const apply = () =>
      run(async () => {
        await apiService.updateUser(u.id, { role });
        if (u.id === me?.id) await refresh();
      });
    if (role === 'user') {
      setPending({
        title: 'Rolle ändern',
        message: `${u.name || u.email} verliert die Administrator-Rechte${u.id === me?.id ? ' – das sind Sie selbst' : ''}. Fortfahren?`,
        confirmText: 'Zu Nutzer ändern',
        run: apply,
      });
    } else {
      void apply();
    }
  };

  const toggleActive = (u: AuthUser) => {
    if (!u.isActive) {
      void run(async () => {
        await apiService.updateUser(u.id, { isActive: true });
      });
      return;
    }
    setPending({
      title: 'Nutzer deaktivieren',
      message: `${u.name || u.email} kann sich danach nicht mehr anmelden und alle Sitzungen werden beendet. Fortfahren?`,
      confirmText: 'Deaktivieren',
      run: () =>
        run(async () => {
          await apiService.updateUser(u.id, { isActive: false });
        }),
    });
  };

  const resetLink = (u: AuthUser) => {
    setLinkInfo(null);
    void run(async () => {
      const { link } = await apiService.createResetLink(u.id);
      setLinkInfo({ title: `Passwort-Reset-Link für ${u.email} (1 Stunde gültig)`, link });
    });
  };

  const resetTotp = (u: AuthUser) =>
    setPending({
      title: '2FA zurücksetzen',
      message: `Die Zwei-Faktor-Authentifizierung von ${u.name || u.email} wird entfernt. Der Nutzer muss sie neu einrichten. Fortfahren?`,
      confirmText: '2FA zurücksetzen',
      run: () => run(() => apiService.resetUserTotp(u.id)),
    });

  const endSessions = (u: AuthUser) =>
    setPending({
      title: 'Sitzungen beenden',
      message: `Alle aktiven Sitzungen von ${u.name || u.email} werden beendet. Fortfahren?`,
      confirmText: 'Sitzungen beenden',
      run: () => run(() => apiService.revokeUserSessions(u.id)),
    });

  // Nicht destruktiv: keine Bestätigung nötig.
  const unlock = (u: AuthUser) => run(() => apiService.unlockUser(u.id));

  const linkBtn = 'text-xs text-primary-custom hover:underline disabled:opacity-50';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
      <div className="flex items-center mb-4">
        <Users className="h-5 w-5 text-primary-custom mr-2" />
        <h3 className="text-lg font-semibold text-gray-900">Nutzerverwaltung</h3>
      </div>

      <fieldset disabled={demo} className="space-y-4 min-w-0">
        <DemoDisabledNotice />
        {error && (
          <div role="alert" className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
            {error}
          </div>
        )}

        {operator?.active && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-700">
            Support-Zugang des Betreibers: aktiv – letzter Login {formatDate(operator.lastLoginAt)}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 border-b border-gray-200">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">E-Mail</th>
                <th className="py-2 pr-4">Rolle</th>
                <th className="py-2 pr-4">2FA</th>
                <th className="py-2 pr-4">Letzter Login</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-gray-100 align-top">
                  <td className="py-2 pr-4">
                    {u.name}
                    {u.id === me?.id && <span className="ml-1 text-xs text-gray-500">(Sie)</span>}
                  </td>
                  <td className="py-2 pr-4">{u.email}</td>
                  <td className="py-2 pr-4">
                    <select
                      value={u.role}
                      disabled={busy}
                      onChange={(e) => changeRole(u, e.target.value as AuthRole)}
                      className="border border-gray-300 rounded-lg px-2 py-1 text-sm"
                      aria-label={`Rolle von ${u.email}`}
                    >
                      <option value="admin">Administrator</option>
                      <option value="user">Nutzer</option>
                    </select>
                  </td>
                  <td className="py-2 pr-4">{u.totpEnabled ? 'Aktiv' : 'Aus'}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{formatDate(u.lastLoginAt)}</td>
                  <td className="py-2 pr-4">
                    {u.isActive ? 'Aktiv' : 'Deaktiviert'}
                    {isLocked(u) && (
                      <div className="text-xs text-red-700 whitespace-nowrap">Gesperrt bis {formatDate(u.lockedUntil)}</div>
                    )}
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <button type="button" disabled={busy} onClick={() => toggleActive(u)} className={linkBtn}>
                        {u.isActive ? 'Deaktivieren' : 'Aktivieren'}
                      </button>
                      {isLocked(u) && (
                        <button type="button" disabled={busy} onClick={() => void unlock(u)} className={linkBtn}>
                          Sperre aufheben
                        </button>
                      )}
                      <button type="button" disabled={busy} onClick={() => resetLink(u)} className={linkBtn}>
                        Reset-Link
                      </button>
                      <button type="button" disabled={busy || !u.totpEnabled} onClick={() => resetTotp(u)} className={linkBtn}>
                        2FA zurücksetzen
                      </button>
                      <button type="button" disabled={busy} onClick={() => endSessions(u)} className={linkBtn}>
                        Sessions beenden
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {linkInfo && <LinkBox {...linkInfo} />}

        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <h4 className="font-medium text-gray-900">Nutzer einladen</h4>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  invite();
                }
              }}
              placeholder="E-Mail-Adresse"
              aria-label="E-Mail-Adresse"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as AuthRole)}
              aria-label="Rolle"
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="user">Nutzer</option>
              <option value="admin">Administrator</option>
            </select>
            <button
              type="button"
              onClick={invite}
              disabled={busy || !inviteEmail.trim()}
              className="inline-flex items-center justify-center px-4 py-2 bg-primary-custom text-white rounded-lg text-sm hover:brightness-90 disabled:opacity-50"
            >
              <UserPlus className="h-4 w-4 mr-2" />
              Einladen
            </button>
          </div>
        </div>
      </fieldset>

      <ConfirmationModal
        isOpen={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={() => void pending?.run()}
        title={pending?.title ?? ''}
        message={pending?.message ?? ''}
        confirmText={pending?.confirmText}
        isDestructive
      />
    </div>
  );
}
