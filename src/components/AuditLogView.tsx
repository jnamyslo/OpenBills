import React, { useCallback, useEffect, useState } from 'react';
import { ScrollText, Download } from 'lucide-react';
import { apiService } from '../services/api';
import { errorMessage } from '../utils/authRoutes';
import type { AuditLogFilters, AuditLogPage, AuthUser } from '../types';

const ACTION_PREFIXES = ['auth.', 'user.', 'backup.', 'PUT', 'POST', 'DELETE'];

export function AuditLogView() {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditLogPage | null>(null);
  const [error, setError] = useState('');

  const filters: AuditLogFilters = {
    from: from || undefined,
    to: to || undefined,
    userId: userId || undefined,
    action: action || undefined,
    page,
  };
  const filterKey = JSON.stringify(filters);

  useEffect(() => {
    apiService.getUsers().then((r) => setUsers(r.users)).catch(() => setUsers([]));
  }, []);

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await apiService.getAuditLog(JSON.parse(filterKey) as AuditLogFilters));
    } catch (e) {
      setError(errorMessage(e, 'Audit-Log konnte nicht geladen werden.'));
    }
  }, [filterKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const onFilter = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setter(e.target.value);
    setPage(1);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const input = 'px-3 py-2 border border-gray-300 rounded-lg text-sm';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
      <div className="flex items-center mb-4">
        <ScrollText className="h-5 w-5 text-primary-custom mr-2" />
        <h3 className="text-lg font-semibold text-gray-900">Audit-Log</h3>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="text-sm text-gray-700">
            Von
            <input type="date" value={from} onChange={onFilter(setFrom)} className={`${input} w-full mt-1`} />
          </label>
          <label className="text-sm text-gray-700">
            Bis
            <input type="date" value={to} onChange={onFilter(setTo)} className={`${input} w-full mt-1`} />
          </label>
          <label className="text-sm text-gray-700">
            Nutzer
            <select value={userId} onChange={onFilter(setUserId)} className={`${input} w-full mt-1`}>
              <option value="">Alle</option>
              {users.filter((u) => !u.isOperator).map((u) => (
                <option key={u.id} value={String(u.id)}>{u.name || u.email}</option>
              ))}
              <option value="operator">Support-Zugang</option>
            </select>
          </label>
          <label className="text-sm text-gray-700">
            Aktion
            <select value={action} onChange={onFilter(setAction)} className={`${input} w-full mt-1`}>
              <option value="">Alle</option>
              {ACTION_PREFIXES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs text-gray-500">Einträge werden 90 Tage aufbewahrt.</p>
          <a
            href={apiService.auditLogCsvUrl(filters)}
            download
            className="inline-flex items-center px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <Download className="h-4 w-4 mr-2" />
            CSV exportieren
          </a>
        </div>

        {error && (
          <div role="alert" className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">{error}</div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 border-b border-gray-200">
                <th className="py-2 pr-4">Zeitpunkt</th>
                <th className="py-2 pr-4">Nutzer</th>
                <th className="py-2 pr-4">Aktion</th>
                <th className="py-2 pr-4">Objekt</th>
                <th className="py-2">IP</th>
              </tr>
            </thead>
            <tbody>
              {data?.entries.map((entry) => (
                <tr key={entry.id} className="border-b border-gray-100">
                  <td className="py-2 pr-4 whitespace-nowrap">{new Date(entry.at).toLocaleString('de-DE')}</td>
                  <td className="py-2 pr-4">
                    {entry.actorLabel ?? '–'}
                    {entry.isOperator && (
                      <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-gray-200 text-gray-800">Support</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">{entry.action}</td>
                  <td className="py-2 pr-4">
                    {entry.entityType ? `${entry.entityType}${entry.entityId ? ` ${entry.entityId}` : ''}` : '–'}
                  </td>
                  <td className="py-2">{entry.ip ?? '–'}</td>
                </tr>
              ))}
              {data && data.entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-gray-500">Keine Einträge gefunden.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>Seite {page} von {totalPages}{data ? ` (${data.total} Einträge)` : ''}</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1 border border-gray-300 rounded-lg disabled:opacity-50"
            >
              Zurück
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 border border-gray-300 rounded-lg disabled:opacity-50"
            >
              Weiter
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
