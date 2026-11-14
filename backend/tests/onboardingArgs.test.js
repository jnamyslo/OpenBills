import { describe, it, expect } from 'vitest';
import { parseOnboardingArgs } from '../scripts/onboarding.js';

describe('parseOnboardingArgs', () => {
  it('ohne Flags sendet nichts', () => expect(parseOnboardingArgs([])).toEqual({ sendTo: null, platformEnvFromStdin: false }));
  it('--send-to mit Adresse', () => expect(parseOnboardingArgs(['--send-to', 'k@firma.de', '--platform-env-stdin'])).toEqual({ sendTo: 'k@firma.de', platformEnvFromStdin: true }));
  it('--send-to ohne Wert wirft', () => expect(() => parseOnboardingArgs(['--send-to'])).toThrow('E-Mail'));
  it('ungültige Adresse wirft', () => expect(() => parseOnboardingArgs(['--send-to', 'kaputt'])).toThrow('E-Mail'));
  it('unbekanntes Flag wirft', () => expect(() => parseOnboardingArgs(['--x'])).toThrow('Unbekannt'));
});
