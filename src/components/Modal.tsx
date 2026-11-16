import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Optionales Symbol links neben dem Titel */
  icon?: React.ReactNode;
  /** Sperrt das X (z. B. während eines laufenden Vorgangs) */
  closeDisabled?: boolean;
  size?: 'md' | 'lg' | 'xl';
  /** Tailwind z-Klasse, z. B. für Dialoge über anderen Overlays */
  zClass?: string;
}

const SIZE_CLASS: Record<NonNullable<ModalProps['size']>, string> = {
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

/**
 * Standard-Overlay: fester Kopf (Titel links, X rechts), scrollbarer Inhalt,
 * optionaler fester Fußbereich (Abbrechen / Speichern).
 * Nicht innerhalb eines <form> rendern (Submit-Events würden nach oben bubbeln).
 */
export function Modal({ title, onClose, children, footer, icon, closeDisabled = false, size = 'md', zClass = 'z-[200]' }: ModalProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !closeDisabled) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, closeDisabled]);

  return (
    <div className={`fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-2 md:p-4 ${zClass}`}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-white rounded-lg shadow-xl w-full ${SIZE_CLASS[size]} max-h-[90dvh] flex flex-col`}
      >
        <div className="flex items-center justify-between p-3 md:p-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center space-x-2 md:space-x-3 min-w-0">
            {icon}
            <h3 className="text-base md:text-lg font-semibold text-gray-900">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            className="text-gray-400 hover:text-gray-600 p-1 disabled:opacity-50"
            aria-label="Schließen"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 md:p-6">{children}</div>
        {footer && (
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 p-3 md:p-4 border-t border-gray-200 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
