import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { apiService } from '../services/api';
import type { DemoInfo } from '../types';
import { setDemoMode } from '../utils/demo';

const DemoContext = createContext<DemoInfo>({ demo: false });

/** Lädt GET /api/demo (öffentlich) – auch vor dem Login, für den Demo-Zugang auf der Login-Seite. */
export function DemoProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<DemoInfo>({ demo: false });

  useEffect(() => {
    let active = true;
    const load = () => {
      apiService.getDemoInfo()
        .then((next) => {
          if (!active) return;
          setDemoMode(next.demo);
          setInfo(next);
        })
        .catch(() => {});
    };
    load();
    // Nächsten Reset-Zeitpunkt aktuell halten.
    const timer = window.setInterval(load, 5 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return <DemoContext.Provider value={info}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoInfo {
  return useContext(DemoContext);
}
