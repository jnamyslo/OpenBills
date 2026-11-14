import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { isAdmin } from '../utils/authRoutes';

const DISMISS_KEY = 'openbills.twofactorBannerDismissed';

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

interface TwoFactorBannerProps {
  onSetup: () => void;
}

export function TwoFactorBanner({ onSetup }: TwoFactorBannerProps) {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(readDismissed);

  if (!user || !isAdmin(user) || user.totpEnabled || dismissed) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Speicher nicht verfügbar: Ausblenden gilt nur für diese Ansicht
    }
    setDismissed(true);
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
      <ShieldAlert className="h-5 w-5 text-amber-600 flex-shrink-0" />
      <p className="text-sm text-amber-800 flex-1">Zwei-Faktor-Authentifizierung wird für Administratoren empfohlen.</p>
      <button onClick={onSetup} className="px-3 py-1.5 text-sm rounded-md bg-amber-600 text-white hover:bg-amber-700">
        Jetzt einrichten
      </button>
      <button onClick={dismiss} className="px-3 py-1.5 text-sm rounded-md text-amber-800 hover:bg-amber-100">
        Ausblenden
      </button>
    </div>
  );
}
