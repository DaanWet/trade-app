import { timeWeightedReturns } from './returns';

describe('timeWeightedReturns', () => {
  it('geeft een lege reeks voor lege invoer', () => {
    expect(timeWeightedReturns([], [])).toEqual([]);
  });

  it('begint op 0 % bij één punt', () => {
    expect(timeWeightedReturns([100], [0])).toEqual([0]);
  });

  it('toont een koersstijging van 10 % zonder geldstromen als +10', () => {
    const r = timeWeightedReturns([100, 110], [0, 0]);

    expect(r[0]).toBe(0);
    expect(r[1]).toBeCloseTo(10, 10);
  });

  it('telt een storting zonder koersbeweging niet als rendement (Totaal)', () => {
    // 100 waard, 50 gestort → 150: nieuw geld, geen winst.
    const r = timeWeightedReturns([100, 150], [0, 50]);

    expect(r[1]).toBeCloseTo(0, 10);
  });

  it('telt een aankoop zonder koersbeweging en zonder kosten niet als rendement (Aandelen)', () => {
    // 100 in aandelen, voor 100 bijgekocht → 200; belegd steeg met 100.
    const r = timeWeightedReturns([100, 200], [0, 100]);

    expect(r[1]).toBeCloseTo(0, 10);
  });

  it('boekt de transactiekost van een aankoop als klein verlies', () => {
    // Belegd stijgt met 101 (100 aandelen + 1 kost), de marktwaarde maar met 100.
    const r = timeWeightedReturns([100, 200], [0, 101]);

    expect(r[1]).toBeCloseTo((-1 / 201) * 100, 10);
    expect(r[1]).toBeLessThan(0);
  });

  it('rekent de eerste aankoop vanaf 0 als (V − F) / F', () => {
    const r = timeWeightedReturns([0, 110], [0, 100]);

    expect(r[1]).toBeCloseTo(10, 10);
  });

  it('geeft geen NaN of Infinity bij een volledige verkoop naar 0', () => {
    // Verkocht aan de vorige slotkoers, daarna niets meer in bezit.
    const r = timeWeightedReturns([100, 0, 0, 0], [0, -100, 0, 0]);

    expect(r.every(Number.isFinite)).toBeTrue();
    expect(r[1]).toBeCloseTo(0, 10);
    expect(r[3]).toBeCloseTo(0, 10);
  });

  it('telt bij volledige verkoop onder de vorige slotkoers het echte verlies, niet −100 %', () => {
    // Slot gisteren 100, alles verkocht voor 95: −5 %. Neem je de uitstroom aan het begin
    // van de periode, dan wordt de noemer 100 − 95 = 5 en zakt de lijn naar −100 %.
    const r = timeWeightedReturns([100, 0], [0, -95]);

    expect(r[1]).toBeCloseTo(-5, 10);
  });

  it('telt bij een volledige verkoop boven de vorige slotkoers de echte winst', () => {
    const r = timeWeightedReturns([100, 0], [0, -110]);

    expect(r[1]).toBeCloseTo(10, 10);
  });

  it('geeft 0 voor een periode zonder waarde en zonder geldstroom', () => {
    const r = timeWeightedReturns([0, 0, 0], [0, 0, 0]);

    expect(r).toEqual([0, 0, 0]);
  });

  it('stapelt opeenvolgende periodes samen (+10 % en +10 % → +21 %)', () => {
    const r = timeWeightedReturns([100, 110, 121], [0, 0, 0]);

    expect(r[2]).toBeCloseTo(21, 10);
  });

  it('negeert flows[0]: geld vóór het eerste zichtbare punt is geen rendement', () => {
    const r = timeWeightedReturns([100, 110], [999, 0]);

    expect(r[0]).toBe(0);
    expect(r[1]).toBeCloseTo(10, 10);
  });

  it('meet rendement over een storting heen alleen op het belegde geld', () => {
    // +10 % op 100, dan 90 gestort (→ 200), dan +10 % op 200: samen +21 %.
    const r = timeWeightedReturns([100, 110, 200, 220], [0, 0, 90, 0]);

    expect(r[2]).toBeCloseTo(10, 10);
    expect(r[3]).toBeCloseTo(21, 10);
  });
});
