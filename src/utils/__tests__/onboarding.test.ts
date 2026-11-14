import { describe, it, expect } from 'vitest';
import { getOnboardingSteps } from '../onboarding';
import type { PlanFeature } from '../../types';

const features = (...f: PlanFeature[]) => (x: PlanFeature) => f.includes(x);

describe('getOnboardingSteps', () => {
  it('gibt normalen Benutzern nur Willkommen und Abschluss', () => {
    expect(getOnboardingSteps(false, features('reminders', 'email'))).toEqual(['welcome', 'fertig']);
  });

  it('lässt tarifabhängige Schritte für Admins ohne Feature weg', () => {
    expect(getOnboardingSteps(true, features())).toEqual(['welcome', 'firma', 'zahlung', 'rechnungen', 'fertig']);
  });

  it('nimmt Mahnwesen und E-Mail mit, wenn der Tarif sie enthält', () => {
    expect(getOnboardingSteps(true, features('reminders', 'email'))).toEqual([
      'welcome', 'firma', 'zahlung', 'rechnungen', 'mahnwesen', 'email', 'fertig',
    ]);
  });
});
