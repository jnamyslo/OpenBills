import { useEffect, useRef } from 'react';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useAuth } from '../context/AuthContext';
import { useDemo } from '../context/DemoContext';
import { isAdmin } from '../utils/authRoutes';
import { DEMO_TOUR_MOBILE_NAV_EVENT, getTourSteps } from '../utils/onboarding';

/** Unterhalb von Tailwind `lg` ist die Navigation ein ausklappbares Seitenmenü. */
const MOBILE_QUERY = '(max-width: 1023px)';
/** Dauer der Einblend-Animation des Seitenmenüs (`duration-300` in Layout) plus Puffer. */
const MOBILE_NAV_TRANSITION_MS = 350;

function setMobileNav(open: boolean) {
  window.dispatchEvent(new CustomEvent<boolean>(DEMO_TOUR_MOBILE_NAV_EVENT, { detail: open }));
}

/**
 * Geführte Tour. Demo: nach jedem aktiven Login (nicht bei Seiten-Reload) und über das Benutzermenü.
 * Normale Instanzen: einmalig nach dem ersten Einrichtungsassistenten eines Benutzers und über das Benutzermenü.
 */
export function DemoTour({ ready }: { ready: boolean }) {
  const { demo } = useDemo();
  const { user, freshLogin, tourRequested, consumeFreshLogin, setOnboardingCompleted } = useAuth();
  const tourRef = useRef<Driver | null>(null);
  const timerRef = useRef<number>();

  // Nur beim Unmount beenden – consumeFreshLogin() löst den Effekt unten erneut aus.
  useEffect(() => () => {
    window.clearTimeout(timerRef.current);
    tourRef.current?.destroy();
  }, []);

  useEffect(() => {
    const triggered = (demo && freshLogin) || tourRequested;
    // Admins: erst nach dem Einrichtungsassistenten.
    const wizardPending = !demo && isAdmin(user) && !user?.onboardingCompleted;
    if (!triggered || !ready || !user || wizardPending) return;
    // Normale Benutzer: erste Tour ersetzt den Assistenten und gilt danach als erledigt.
    const completesOnboarding = !demo && !user.onboardingCompleted;
    consumeFreshLogin();
    tourRef.current?.destroy();

    const mobile = window.matchMedia(MOBILE_QUERY).matches;

    const start = () => {
      // Schritte ohne sichtbares Ziel (z. B. deaktivierte Module) entfallen.
      const steps = getTourSteps(demo).filter((step) => {
        if (!step.selector) return true;
        const el = document.querySelector(step.selector);
        return el !== null && el.getBoundingClientRect().right > 0;
      }).map((step) => ({
        element: step.selector,
        popover: {
          title: step.title,
          description: step.description,
          side: mobile ? ('bottom' as const) : (step.side ?? 'right'),
        },
      }));

      const tour = driver({
        showProgress: true,
        progressText: '{{current}} von {{total}}',
        nextBtnText: 'Weiter',
        prevBtnText: 'Zurück',
        doneBtnText: 'Fertig',
        steps,
        onDestroyed: () => {
          if (mobile) setMobileNav(false);
          if (completesOnboarding) void setOnboardingCompleted(true).catch(() => undefined);
        },
      });
      tourRef.current = tour;
      tour.drive();
    };

    if (mobile) {
      // Seitenmenü einblenden und Animation abwarten, damit die Navigationspunkte messbar sind.
      setMobileNav(true);
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(start, MOBILE_NAV_TRANSITION_MS);
    } else {
      start();
    }
  }, [demo, user, freshLogin, tourRequested, ready, consumeFreshLogin, setOnboardingCompleted]);

  return null;
}
