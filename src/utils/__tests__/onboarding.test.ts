import { describe, it, expect } from 'vitest';
import { getOnboardingSteps } from '../onboarding';
import type { PlanFeature } from '../../types';

const features = (...f: PlanFeature[]) => (x: PlanFeature) => f.includes(x);

describe('getOnboardingSteps', () => {
  it('lässt tarifabhängige Schritte ohne Feature weg', () => {
    expect(getOnboardingSteps(features())).toEqual(['welcome', 'firma', 'zahlung', 'rechnungen', 'fertig']);
  });

  it('nimmt Mahnwesen und E-Mail mit, wenn der Tarif sie enthält', () => {
    expect(getOnboardingSteps(features('reminders', 'email'))).toEqual([
      'welcome', 'firma', 'zahlung', 'rechnungen', 'mahnwesen', 'email', 'fertig',
    ]);
  });
});
