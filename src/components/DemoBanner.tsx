import { FlaskConical } from 'lucide-react';
import { useDemo } from '../context/DemoContext';

export function DemoBanner() {
  const { demo } = useDemo();
  if (!demo) return null;
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <FlaskConical className="h-4 w-4 mt-0.5 flex-shrink-0" />
      <span>
        Demo-Instanz – Ihre Änderungen sieht niemand sonst und sie werden beim Abmelden gelöscht. E-Mails werden nicht versendet.
      </span>
    </div>
  );
}
