import { createContext } from 'react';

/** Meldet der Einstellungs-Hülle, ob der aktive Bereich ungespeicherte Änderungen hat. */
export const SettingsDirtyContext = createContext<{ setDirty: (dirty: boolean) => void }>({
  setDirty: () => {},
});
