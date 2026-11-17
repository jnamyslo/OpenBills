import React from 'react';
import { X } from 'lucide-react';

interface PageShellProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** Optional unter dem Titel, z. B. die Belegkette */
  header?: React.ReactNode;
  children: React.ReactNode;
  /** Feste Fußleiste (Abbrechen / Speichern). Submit-Buttons außerhalb des <form> brauchen das Attribut `form`. */
  footer?: React.ReactNode;
}

/**
 * Standard-Vollseite für große Formulare (Rechnung, Angebot, Auftrag):
 * Kopf mit Titel und X, Inhalt, Sticky-Fußleiste.
 */
export function PageShell({ title, subtitle, onClose, header, children, footer }: PageShellProps) {
  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex justify-between items-start">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 break-words">{title}</h2>
            {subtitle && <p className="text-gray-600 mt-1 text-sm sm:text-base break-words">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 ml-4 flex-shrink-0 p-1"
            aria-label="Schließen"
            title="Schließen"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        {header}
      </div>

      {children}

      {footer && (
        <div className="sticky bottom-0 z-10 -mx-3 sm:-mx-4 lg:-mx-6 px-3 sm:px-4 lg:px-6 py-3 bg-white border-t border-gray-200 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          {footer}
        </div>
      )}
    </div>
  );
}
