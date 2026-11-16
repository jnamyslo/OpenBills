import { describe, it, expect } from 'vitest';
import { parsePlanChangeArgs } from '../scripts/planChange.js';

describe('parsePlanChangeArgs', () => {
  it('nur --old', () => expect(parsePlanChangeArgs(['--old', 'free'])).toEqual({ oldPlan: 'free', sendTo: null, platformEnvFromStdin: false }));
  it('alle Optionen', () => expect(parsePlanChangeArgs(['--old', 'starter', '--send-to', 'k@firma.de', '--platform-env-stdin'])).toEqual({ oldPlan: 'starter', sendTo: 'k@firma.de', platformEnvFromStdin: true }));
  it('ohne --old wirft', () => expect(() => parsePlanChangeArgs([])).toThrow('--old'));
  it('ungültiger Tarif wirft', () => expect(() => parsePlanChangeArgs(['--old', 'gold'])).toThrow('Tarif'));
  it('ungültige Adresse wirft', () => expect(() => parsePlanChangeArgs(['--old', 'free', '--send-to', 'x'])).toThrow('E-Mail'));
  it('unbekanntes Flag wirft', () => expect(() => parsePlanChangeArgs(['--old', 'free', '--x'])).toThrow('Unbekannt'));
});
