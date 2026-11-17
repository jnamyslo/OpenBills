import { useEffect, useState } from 'react';
import { apiService } from '../services/api';
import { PASSWORD_MIN_LENGTH } from '../utils/authRoutes';

/** Mindestlänge laut Server (PASSWORD_MIN_LENGTH); bis zum Laden bzw. bei Fehler 12. */
export function usePasswordMinLength(): number {
  const [minLength, setMinLength] = useState(PASSWORD_MIN_LENGTH);
  useEffect(() => {
    let active = true;
    apiService.getPasswordPolicy()
      .then((policy) => { if (active) setMinLength(policy.minLength); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return minLength;
}
