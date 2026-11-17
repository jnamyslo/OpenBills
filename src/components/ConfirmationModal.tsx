import { Modal } from './Modal';
import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  isGoBDWarning?: boolean;
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Bestätigen',
  cancelText = 'Abbrechen',
  isDestructive = false,
  isGoBDWarning = false
}: ConfirmationModalProps) {
  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <Modal
      title={title}
      icon={
        <div className={`p-2 rounded-full ${isGoBDWarning ? 'bg-amber-100' : isDestructive ? 'bg-red-100' : 'bg-primary-custom/10'}`}>
          <AlertTriangle className={`h-6 w-6 ${isGoBDWarning ? 'text-amber-600' : isDestructive ? 'text-red-600' : 'text-primary-custom'}`} />
        </div>
      }
      onClose={onClose}
      zClass="z-50"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={`px-4 py-2 rounded-lg text-white transition-colors ${
              isDestructive 
                ? 'bg-red-600 hover:bg-red-700' 
                : isGoBDWarning
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'btn-primary'
            }`}
          >
            {confirmText}
          </button>
        </>
      }
    >
        <div>
          {isGoBDWarning && (
            <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <h4 className="text-sm font-semibold text-amber-800 mb-2">
                ⚠️ GoBD-Konformitätshinweis
              </h4>
              <p className="text-sm text-amber-700">
                Nach den Grundsätzen zur ordnungsmäßigen Führung und Aufbewahrung von Büchern (GoBD) 
                sind Änderungen an bereits versendeten Rechnungen kritisch zu bewerten.
              </p>
            </div>
          )}
          
          <p className="text-gray-600 leading-relaxed">{message}</p>
        </div>
    </Modal>
  );
}
