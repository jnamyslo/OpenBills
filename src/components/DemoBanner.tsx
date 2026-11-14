import { FlaskConical } from 'lucide-react';
import { useDemo } from '../context/DemoContext';
import { formatResetTime } from '../utils/demo';

export function DemoBanner() {
  const { demo, nextResetAt } = useDemo();
  if (!demo) return null;
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <FlaskConical className="h-4 w-4 mt-0.5 flex-shrink-0" />
      <span>
        Demo-Instanz – alle Daten werden alle 3 Stunden zurückgesetzt
        {nextResetAt && <> (nächster Reset: {formatResetTime(nextResetAt)} Uhr)</>}. E-Mails werden nicht versendet.
      </span>
    </div>
  );
}
