import { describe, expect, it } from 'vitest';
import { withExplicitGlobalDiscount } from '../api';

const sent = (data: object) => JSON.parse(JSON.stringify(withExplicitGlobalDiscount(data)));

describe('withExplicitGlobalDiscount', () => {
  it('sendet „Kein Gesamtrabatt“ als null, damit das Backend den alten Rabatt entfernt', () => {
    expect(sent({ globalDiscountType: undefined, globalDiscountValue: undefined }))
      .toEqual({ globalDiscountType: null, globalDiscountValue: null });
  });

  it('Rabatttyp ohne Wert gilt als kein Rabatt (wie in der Summenberechnung)', () => {
    expect(sent({ globalDiscountType: 'percentage', globalDiscountValue: undefined }))
      .toEqual({ globalDiscountType: null, globalDiscountValue: null });
  });

  it('übernimmt gesetzte Rabatte unverändert', () => {
    expect(sent({ globalDiscountType: 'fixed', globalDiscountValue: 15 }))
      .toEqual({ globalDiscountType: 'fixed', globalDiscountValue: 15 });
    expect(sent({ globalDiscountType: 'percentage', globalDiscountValue: 0 }))
      .toEqual({ globalDiscountType: 'percentage', globalDiscountValue: 0 });
  });

  it('lässt Teil-Updates ohne Rabattfelder unberührt', () => {
    expect(sent({ status: 'paid' })).toEqual({ status: 'paid' });
  });
});
