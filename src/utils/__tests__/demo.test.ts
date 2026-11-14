import { describe, expect, it } from 'vitest';
import { demoMailNote, formatResetTime, setDemoMode } from '../demo';

describe('formatResetTime', () => {
  it('formatiert als HH:MM (lokal)', () => {
    const iso = '2026-11-14T15:00:00.000Z';
    const expected = new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    expect(formatResetTime(iso)).toBe(expected);
    expect(formatResetTime(iso)).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe('demoMailNote', () => {
  it('nur im Demo-Modus ein Hinweis', () => {
    setDemoMode(false);
    expect(demoMailNote()).toBe('');
    setDemoMode(true);
    expect(demoMailNote()).toBe('\n\nDemo: E-Mail wurde nicht wirklich versendet.');
    setDemoMode(false);
  });
});
