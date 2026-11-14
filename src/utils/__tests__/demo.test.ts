import { describe, expect, it } from 'vitest';
import { demoMailNote, setDemoMode } from '../demo';

describe('demoMailNote', () => {
  it('nur im Demo-Modus ein Hinweis', () => {
    setDemoMode(false);
    expect(demoMailNote()).toBe('');
    setDemoMode(true);
    expect(demoMailNote()).toBe('\n\nDemo: E-Mail wurde nicht wirklich versendet.');
    setDemoMode(false);
  });
});
