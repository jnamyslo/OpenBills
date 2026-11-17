import { useDemo } from '../context/DemoContext';

/** Hinweis über Bereichen, deren Aktionen im Demo-Modus gesperrt sind (Backend antwortet 403). */
export function DemoDisabledNotice() {
  const { demo } = useDemo();
  if (!demo) return null;
  return <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">In der Demo deaktiviert</p>;
}
