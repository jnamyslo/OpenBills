import { Save } from 'lucide-react';
import type { SectionForm } from './useSectionForm';

type SaveBarProps = Pick<SectionForm, 'dirty' | 'saving' | 'status' | 'discard'> & {
  onSave: () => void;
};

export function SaveBar({ dirty, saving, status, discard, onSave }: SaveBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 pt-4 mt-6 border-t border-gray-100">
      {status === 'saved' && <span className="text-sm text-green-700">Gespeichert</span>}
      {status === 'error' && <span className="text-sm text-red-600">Speichern fehlgeschlagen</span>}
      <button
        type="button"
        onClick={discard}
        disabled={!dirty || saving}
        className="px-4 py-2 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        Verwerfen
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty || saving}
        className="btn-primary text-white px-4 lg:px-6 py-2 rounded-xl hover:brightness-90 transition-all duration-300 flex items-center space-x-2 disabled:opacity-50"
      >
        <Save className="h-4 w-4" />
        <span>{saving ? 'Speichert...' : 'Speichern'}</span>
      </button>
    </div>
  );
}
