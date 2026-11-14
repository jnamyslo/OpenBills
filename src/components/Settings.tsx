import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeft, Briefcase, Building2, ChevronRight, Clock, CreditCard, Database, FileText, Globe, Hash,
  Mail, Package, Palette, ScrollText, Users,
} from 'lucide-react';
import { ConfirmationModal } from './ConfirmationModal';
import { BackupManagement } from './BackupManagement';
import { EmailManagement } from './EmailManagement';
import { UserManagement } from './UserManagement';
import { AuditLogView } from './AuditLogView';
import { SETTINGS_SECTIONS, SettingsGroup, SettingsSectionId, resolveSection } from './settings/sections';
import { SettingsDirtyContext } from './settings/SettingsDirtyContext';
import { FirmenprofilSection } from './settings/FirmenprofilSection';
import { ErscheinungsbildSection } from './settings/ErscheinungsbildSection';
import { ZahlungSection } from './settings/ZahlungSection';
import { RechnungenSection } from './settings/RechnungenSection';
import { NummernkreiseSection } from './settings/NummernkreiseSection';
import { ERechnungSection } from './settings/ERechnungSection';
import { MahnwesenSection } from './settings/MahnwesenSection';
import { LeistungenSection } from './settings/LeistungenSection';
import { ModuleSection } from './settings/ModuleSection';

const ICONS: Record<SettingsSectionId, LucideIcon> = {
  firmenprofil: Building2,
  erscheinungsbild: Palette,
  zahlung: CreditCard,
  rechnungen: FileText,
  nummernkreise: Hash,
  erechnung: Globe,
  mahnwesen: Clock,
  leistungen: Package,
  module: Briefcase,
  email: Mail,
  benutzer: Users,
  backup: Database,
  audit: ScrollText,
};

const GROUPS: SettingsGroup[] = ['Firma', 'Dokumente', 'System'];

interface SettingsProps {
  /** Bereich aus dem Hash (`#settings/<bereich>`); fehlt er, zeigt Mobil die Kachelliste. */
  section?: string;
  onNavigate: (id: SettingsSectionId) => void;
}

export function Settings({ section, onNavigate }: SettingsProps) {
  const [activeId, setActiveId] = useState<SettingsSectionId>(() => resolveSection(section));
  const [pendingId, setPendingId] = useState<SettingsSectionId | null>(null);
  const dirtyRef = useRef(false);
  // ConfirmationModal ruft nach onConfirm auch onClose auf – dann nichts zurücksetzen.
  const confirmedRef = useRef(false);
  const setDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);
  const dirtyContext = useMemo(() => ({ setDirty }), [setDirty]);

  // Hash-Wechsel von außen (Browser-Zurück, Link): bei offenen Änderungen erst nachfragen.
  useEffect(() => {
    const target = resolveSection(section);
    if (target === activeId) return;
    if (dirtyRef.current) setPendingId(target);
    else setActiveId(target);
  }, [section, activeId]);

  const requestNavigate = (id: SettingsSectionId) => {
    if (id === activeId) {
      if (!section) onNavigate(id);
      return;
    }
    if (dirtyRef.current) setPendingId(id);
    else onNavigate(id);
  };

  const confirmDiscard = () => {
    if (!pendingId) return;
    confirmedRef.current = true;
    dirtyRef.current = false;
    setActiveId(pendingId);
    if (resolveSection(section) !== pendingId) onNavigate(pendingId);
    setPendingId(null);
  };

  const cancelDiscard = () => {
    if (confirmedRef.current) {
      confirmedRef.current = false;
      return;
    }
    if (resolveSection(section) !== activeId) {
      window.history.replaceState(null, '', `#settings/${activeId}`);
    }
    setPendingId(null);
  };

  const renderSection = () => {
    switch (activeId) {
      case 'firmenprofil': return <FirmenprofilSection />;
      case 'erscheinungsbild': return <ErscheinungsbildSection />;
      case 'zahlung': return <ZahlungSection />;
      case 'rechnungen': return <RechnungenSection />;
      case 'nummernkreise': return <NummernkreiseSection />;
      case 'erechnung': return <ERechnungSection />;
      case 'mahnwesen': return <MahnwesenSection onNavigate={requestNavigate} />;
      case 'leistungen': return <LeistungenSection />;
      case 'module': return <ModuleSection />;
      case 'email': return (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Alle gesendeten E-Mails werden automatisch archiviert (nicht löschbar). Hier konfigurieren Sie den Versand und senden Test-E-Mails.
          </p>
          <EmailManagement embedded />
        </div>
      );
      case 'benutzer': return <UserManagement />;
      case 'backup': return (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Erstellen Sie vor wichtigen Änderungen ein Backup und bewahren Sie es an einem sicheren Ort auf. Ein Backup enthält alle Kunden, Rechnungen, Aufträge und Einstellungen.
          </p>
          <BackupManagement embedded />
        </div>
      );
      case 'audit': return <AuditLogView />;
    }
  };

  const showMobileList = !section;

  return (
    <SettingsDirtyContext.Provider value={dirtyContext}>
      <div className="min-h-screen bg-gray-50 p-3 sm:p-4 lg:p-6">
        <div className="mb-4 lg:mb-6">
          <h1 className="text-xl lg:text-2xl font-bold text-gray-900">Einstellungen</h1>
          <p className="text-sm lg:text-base text-gray-600 mt-1">Verwalten Sie Ihre Firmendaten und Anwendungseinstellungen</p>
        </div>

        {showMobileList && (
          <div className="lg:hidden space-y-5">
            {GROUPS.map((group) => (
              <div key={group}>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{group}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {SETTINGS_SECTIONS.filter((s) => s.group === group).map((s) => {
                    const Icon = ICONS[s.id];
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => requestNavigate(s.id)}
                        className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-100 shadow-sm text-left"
                      >
                        <Icon className="h-5 w-5 text-primary-custom flex-shrink-0" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-gray-900">{s.label}</span>
                          <span className="block text-xs text-gray-500 truncate">{s.description}</span>
                        </span>
                        <ChevronRight className="h-4 w-4 text-gray-400" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className={`lg:flex lg:gap-6 ${showMobileList ? 'hidden' : ''}`}>
          <nav className="hidden lg:block w-60 flex-shrink-0" aria-label="Einstellungsbereiche">
            <div className="sticky top-6 space-y-5">
              {GROUPS.map((group) => (
                <div key={group}>
                  <h2 className="px-3 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{group}</h2>
                  <ul className="space-y-0.5">
                    {SETTINGS_SECTIONS.filter((s) => s.group === group).map((s) => {
                      const Icon = ICONS[s.id];
                      const active = s.id === activeId;
                      return (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => requestNavigate(s.id)}
                            aria-current={active ? 'page' : undefined}
                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                              active ? 'bg-primary-custom/10 text-primary-custom font-medium' : 'text-gray-700 hover:bg-gray-100'
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                            {s.label}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </nav>

          <div className="flex-1 min-w-0">
            <button
              type="button"
              onClick={() => { window.location.hash = 'settings'; }}
              className="lg:hidden inline-flex items-center text-sm text-primary-custom mb-3"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Einstellungen
            </button>
            {renderSection()}
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={pendingId !== null}
        onClose={cancelDiscard}
        onConfirm={confirmDiscard}
        title="Ungespeicherte Änderungen"
        message="Ungespeicherte Änderungen verwerfen?"
        confirmText="Verwerfen"
        cancelText="Abbrechen"
        isDestructive
      />
    </SettingsDirtyContext.Provider>
  );
}
