import { formatDate, formatRelativeTime } from './format';

describe('formatRelativeTime', () => {
  // Lokale tijd, zodat de test niet afhangt van de tijdzone van de testmachine.
  const now = new Date(2026, 9, 15, 12, 0);
  const MIN = 60_000;
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it('zegt "zonet" onder een minuut, ook licht in de toekomst', () => {
    expect(formatRelativeTime(ago(20_000), now)).toBe('zonet');
    expect(formatRelativeTime(ago(-30_000), now)).toBe('zonet');
  });

  it('telt minuten en uren', () => {
    expect(formatRelativeTime(ago(5 * MIN), now)).toBe('5 minuten geleden');
    expect(formatRelativeTime(ago(120 * MIN), now)).toBe('2 uur geleden');
  });

  it('telt kalenderdagen vanaf 24 uur', () => {
    expect(formatRelativeTime(new Date(2026, 9, 14, 9, 0).toISOString(), now)).toBe('gisteren');
    expect(formatRelativeTime(new Date(2026, 9, 9, 9, 0).toISOString(), now)).toBe('6 dagen geleden');
  });

  it('valt na 7 dagen terug op een datum', () => {
    const iso = new Date(2026, 9, 1, 9, 0).toISOString();
    expect(formatRelativeTime(iso, now)).toBe(formatDate(iso));
  });

  it('geeft — voor een lege waarde', () => {
    expect(formatRelativeTime(null, now)).toBe('—');
  });
});
