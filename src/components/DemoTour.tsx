import { useEffect, useRef } from 'react';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useAuth } from '../context/AuthContext';
import { useDemo } from '../context/DemoContext';
import { DEMO_TOUR_STEPS } from '../utils/onboarding';

/** Geführte Tour der Demo-Instanz: startet nach jedem aktiven Login (nicht bei Seiten-Reload). */
export function DemoTour({ ready }: { ready: boolean }) {
  const { demo } = useDemo();
  const { freshLogin, consumeFreshLogin } = useAuth();
  const tourRef = useRef<Driver | null>(null);

  // Nur beim Unmount beenden – consumeFreshLogin() löst den Effekt unten erneut aus.
  useEffect(() => () => tourRef.current?.destroy(), []);

  useEffect(() => {
    if (!demo || !freshLogin || !ready) return;
    consumeFreshLogin();

    // Navigation ist auf kleinen Bildschirmen ausgeblendet; Schritte ohne sichtbares Ziel entfallen.
    const steps = DEMO_TOUR_STEPS.filter((step) => {
      if (!step.selector) return true;
      const el = document.querySelector(step.selector);
      return el !== null && el.getBoundingClientRect().right > 0;
    }).map((step) => ({
      element: step.selector,
      popover: { title: step.title, description: step.description, side: 'right' as const },
    }));

    const tour = driver({
      showProgress: true,
      progressText: '{{current}} von {{total}}',
      nextBtnText: 'Weiter',
      prevBtnText: 'Zurück',
      doneBtnText: 'Fertig',
      steps,
    });
    tourRef.current = tour;
    tour.drive();
  }, [demo, freshLogin, ready, consumeFreshLogin]);

  return null;
}
