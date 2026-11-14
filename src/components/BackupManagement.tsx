import React, { useState, useEffect } from 'react';
import { useDemo } from '../context/DemoContext';
import logger from '../utils/logger';
import {
  Save,
  Download,
  Upload,
  Trash2,
  AlertTriangle,
  CheckCircle,
  Clock,
  Database,
  FileText,
  RefreshCw,
  Lock,
  X
} from 'lucide-react';
import { apiService } from '../services/api';

const MIN_PASSPHRASE_LENGTH = 12;

interface BackupInfo {
  filename: string;
  timestamp: string;
  size: number;
  tableCount: number;
  totalRecords: number;
  encrypted: boolean;
  created: string;
}

interface BackupManagementProps {
  onClose?: () => void;
  /** Im Einstellungsbereich statt als Vollbild-Overlay darstellen. */
  embedded?: boolean;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function BackupManagement({ onClose, embedded = false }: BackupManagementProps) {
  const { demo } = useDemo();
  const [zipBackups, setZipBackups] = useState<BackupInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingZipBackup, setIsCreatingZipBackup] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [passphraseRepeat, setPassphraseRepeat] = useState('');
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);

  useEffect(() => {
    loadBackups();
  }, []);

  const loadBackups = async () => {
    setIsLoading(true);
    try {
      const response = await apiService.listAllBackups();
      if (response.success) {
        setZipBackups(response.zipBackups);
      } else {
        setMessage({ type: 'error', text: 'Fehler beim Laden der Backups' });
      }
    } catch (error) {
      logger.error('Error loading backups:', error);
      setMessage({ type: 'error', text: 'Fehler beim Laden der Backups' });
    } finally {
      setIsLoading(false);
    }
  };

  const passphraseError =
    passphrase.length > 0 && passphrase.length < MIN_PASSPHRASE_LENGTH
      ? `Mindestens ${MIN_PASSPHRASE_LENGTH} Zeichen`
      : passphraseRepeat.length > 0 && passphrase !== passphraseRepeat
        ? 'Passwörter stimmen nicht überein'
        : null;
  const canCreate = passphrase.length >= MIN_PASSPHRASE_LENGTH && passphrase === passphraseRepeat;

  const createZipBackup = async () => {
    if (!canCreate) return;
    setIsCreatingZipBackup(true);
    try {
      const response = await apiService.createZipBackup(passphrase);
      if (response.success) {
        setMessage({
          type: 'success',
          text: `Vollbackup erfolgreich erstellt: ${response.totalRecords} Datensätze aus ${response.tableCount} Tabellen`
        });
        setPassphrase('');
        setPassphraseRepeat('');
        await loadBackups();
      } else {
        setMessage({ type: 'error', text: response.message || 'Fehler beim Erstellen des Vollbackups' });
      }
    } catch (error) {
      logger.error('Error creating ZIP backup:', error);
      setMessage({ type: 'error', text: errorText(error, 'Fehler beim Erstellen des Vollbackups') });
    } finally {
      setIsCreatingZipBackup(false);
    }
  };

  const downloadBackup = async (filename: string) => {
    try {
      await apiService.downloadZipBackup(filename);
      setMessage({ type: 'success', text: 'Vollbackup erfolgreich heruntergeladen' });
    } catch (error) {
      logger.error('Error downloading backup:', error);
      setMessage({ type: 'error', text: 'Fehler beim Download des Backups' });
    }
  };

  const deleteBackup = async (filename: string) => {
    if (!confirm(`Sind Sie sicher, dass Sie das Backup "${filename}" löschen möchten?`)) {
      return;
    }

    try {
      const response = await apiService.deleteBackup(filename);
      if (response.success) {
        setMessage({ type: 'success', text: 'Backup erfolgreich gelöscht' });
        await loadBackups();
      } else {
        setMessage({ type: 'error', text: response.message || 'Fehler beim Löschen des Backups' });
      }
    } catch (error) {
      logger.error('Error deleting backup:', error);
      setMessage({ type: 'error', text: 'Fehler beim Löschen des Backups' });
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type === 'application/zip' || file.name.endsWith('.zip')) {
      setSelectedFile(file);
      setRestorePassphrase('');
      setShowRestoreConfirm(true);
    } else {
      setMessage({ type: 'error', text: 'Bitte wählen Sie eine gültige ZIP-Datei aus' });
    }
  };

  const closeRestoreConfirm = () => {
    setShowRestoreConfirm(false);
    setSelectedFile(null);
    setRestorePassphrase('');
  };

  const restoreBackup = async () => {
    if (!selectedFile) return;

    setIsRestoring(true);
    try {
      const response = await apiService.restoreZipBackup(selectedFile, restorePassphrase);

      if (response.success) {
        setMessage({
          type: 'success',
          text: `Vollbackup erfolgreich wiederhergestellt: ${response.restoredRecords} Datensätze aus ${response.restoredTables} Tabellen`
        });
        closeRestoreConfirm();
        // Reload page to reflect restored data
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        setMessage({ type: 'error', text: response.message || 'Fehler beim Wiederherstellen des Backups' });
      }
    } catch (error) {
      logger.error('Error restoring backup:', error);
      setMessage({ type: 'error', text: errorText(error, 'Fehler beim Wiederherstellen des Backups') });
    } finally {
      setIsRestoring(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleString('de-DE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-custom';

  return (
    <div className={embedded ? '' : 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4'}>
      <div className={embedded ? 'bg-white rounded-xl shadow-sm border border-gray-100' : 'bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto'}>
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center">
            <Database className="h-6 w-6 text-primary-custom mr-3" />
            <h2 className="text-xl font-semibold text-gray-900">Daten-Backup und Wiederherstellung</h2>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="h-6 w-6" />
            </button>
          )}
        </div>

        {message && (
          <div className={`mx-6 mt-4 p-4 rounded-lg flex items-center ${
            message.type === 'success' ? 'bg-green-50 border border-green-200 text-green-800' :
            message.type === 'error' ? 'bg-red-50 border border-red-200 text-red-800' :
            'bg-yellow-50 border border-yellow-200 text-yellow-800'
          }`}>
            {message.type === 'success' ? (
              <CheckCircle className="h-5 w-5 mr-2" />
            ) : (
              <AlertTriangle className="h-5 w-5 mr-2" />
            )}
            <span>{message.text}</span>
            <button
              onClick={() => setMessage(null)}
              className="ml-auto text-current opacity-70 hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="p-6 space-y-6">
          {/* Create Backup Section */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-blue-900 mb-4">Backup erstellen</h3>

            <div className="p-4 bg-white rounded-lg space-y-4">
              <div>
                <h4 className="font-medium text-gray-900 mb-1">Vollständiges Backup (ZIP, verschlüsselt)</h4>
                <p className="text-gray-600 text-sm">
                  Sichert alle Daten inklusive Logos und Anhänge als verschlüsseltes ZIP-Archiv.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Backup-Passwort"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  className={inputClass}
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Backup-Passwort wiederholen"
                  value={passphraseRepeat}
                  onChange={(e) => setPassphraseRepeat(e.target.value)}
                  className={inputClass}
                />
              </div>
              {passphraseError && <p className="text-sm text-red-600">{passphraseError}</p>}
              <p className="text-xs text-gray-600 flex items-start">
                <AlertTriangle className="h-4 w-4 mr-1 flex-shrink-0 text-orange-500" />
                Das Passwort wird nicht gespeichert. Ohne dieses Passwort kann das Backup nicht wiederhergestellt werden.
              </p>
              <div className="flex justify-end">
                <button
                  onClick={createZipBackup}
                  disabled={isCreatingZipBackup || !canCreate}
                  className="btn-primary text-white px-4 py-2 rounded-lg hover:brightness-90 transition-colors flex items-center space-x-2 disabled:opacity-50"
                >
                  {isCreatingZipBackup ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  <span>{isCreatingZipBackup ? 'Erstelle...' : 'Vollbackup erstellen'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Restore Backup Section */}
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-6">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-orange-900 mb-2">Backup wiederherstellen</h3>
              <p className="text-orange-700 text-sm mb-4">
                <AlertTriangle className="h-4 w-4 inline mr-1" />
                <strong>Warnung:</strong> Dies überschreibt alle vorhandenen Daten!
              </p>
              {demo && <p className="text-sm text-amber-800">In der Demo deaktiviert</p>}
            </div>

            <div className="flex items-center space-x-4">
              <div className="flex-1">
                <input
                  type="file"
                  accept=".zip"
                  disabled={demo}
                  title={demo ? 'In der Demo deaktiviert' : undefined}
                  onChange={handleFileSelect}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Unterstütztes Dateiformat: ZIP (Vollbackup)
                </p>
              </div>
              {selectedFile && (
                <span className="text-sm text-gray-600">
                  {selectedFile.name} ({formatFileSize(selectedFile.size)})
                </span>
              )}
            </div>
          </div>

          {/* Available Backups */}
          <div className="bg-white border border-gray-200 rounded-lg">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Verfügbare Backups</h3>
              <button
                onClick={loadBackups}
                disabled={isLoading}
                className="text-primary-custom hover:text-primary-custom/80 transition-colors flex items-center space-x-1"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                <span>Aktualisieren</span>
              </button>
            </div>

            {isLoading ? (
              <div className="p-8 text-center">
                <RefreshCw className="h-8 w-8 animate-spin text-gray-400 mx-auto mb-2" />
                <p className="text-gray-500">Lade Backups...</p>
              </div>
            ) : zipBackups.length === 0 ? (
              <div className="p-8 text-center">
                <FileText className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-500">Keine Backups verfügbar</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {zipBackups.map((backup) => (
                  <div key={backup.filename} className="p-4 hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-1">
                          <h5 className="font-medium text-gray-900">{backup.filename}</h5>
                          <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">
                            ZIP - {formatFileSize(backup.size)}
                          </span>
                          {backup.encrypted ? (
                            <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded flex items-center">
                              <Lock className="h-3 w-3 mr-1" />
                              Verschlüsselt
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-800 rounded">
                              Unverschlüsselt
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-4 text-sm text-gray-500">
                          <div className="flex items-center">
                            <Clock className="h-4 w-4 mr-1" />
                            {formatDate(backup.created)}
                          </div>
                          <div className="flex items-center">
                            <Database className="h-4 w-4 mr-1" />
                            {backup.tableCount} Tabellen
                          </div>
                          <div className="flex items-center">
                            <FileText className="h-4 w-4 mr-1" />
                            {backup.totalRecords.toLocaleString('de-DE')} Datensätze
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 ml-4">
                        <button
                          onClick={() => downloadBackup(backup.filename)}
                          className="text-blue-600 hover:text-blue-800 transition-colors p-2 rounded-lg hover:bg-blue-50"
                          title="Herunterladen"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => deleteBackup(backup.filename)}
                          disabled={demo}
                          className="text-red-600 hover:text-red-800 transition-colors p-2 rounded-lg hover:bg-red-50 disabled:opacity-40"
                          title={demo ? 'In der Demo deaktiviert' : 'Löschen'}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Restore Confirmation Modal */}
        {showRestoreConfirm && selectedFile && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="p-6">
                <div className="flex items-center mb-4">
                  <AlertTriangle className="h-6 w-6 text-red-500 mr-3" />
                  <h3 className="text-lg font-semibold text-gray-900">Backup wiederherstellen</h3>
                </div>

                <div className="mb-6">
                  <p className="text-gray-700 mb-4">
                    <strong>Achtung:</strong> Diese Aktion überschreibt alle vorhandenen Daten unwiderruflich!
                  </p>

                  <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm mb-4">
                    <div><strong>Dateiname:</strong> {selectedFile.name}</div>
                    <div><strong>Dateigröße:</strong> {formatFileSize(selectedFile.size)}</div>
                  </div>

                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="restore-passphrase">
                    Backup-Passwort
                  </label>
                  <input
                    id="restore-passphrase"
                    type="password"
                    autoComplete="off"
                    value={restorePassphrase}
                    onChange={(e) => setRestorePassphrase(e.target.value)}
                    className={inputClass}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Leer lassen nur bei alten, unverschlüsselten Backups.
                  </p>
                </div>

                <div className="flex items-center space-x-3">
                  <button
                    onClick={closeRestoreConfirm}
                    className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Abbrechen
                  </button>
                  <button
                    onClick={restoreBackup}
                    disabled={isRestoring}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
                  >
                    {isRestoring ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    <span>{isRestoring ? 'Wiederherstellen...' : 'Wiederherstellen'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
