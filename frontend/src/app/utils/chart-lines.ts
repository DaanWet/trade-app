/**
 * Welke lijnen de portefeuillegrafiek tekent, los van Chart.js.
 *
 * Zonder selectie: Totaal, Aandelen en Netto stortingen. Met een tickerselectie: de waarde
 * van die tickers samen en wat erin geïnvesteerd is. In %-weergave het tijdgewogen
 * rendement (zie returns.ts); lijnen die geld-in tonen in plaats van rendement (stortingen,
 * geïnvesteerd) vallen dan weg — zij hebben geen rendement van zichzelf.
 */
import type { PortfolioPoint } from '../models';
import { timeWeightedReturns } from './returns';

export type ChartLineKey = 'total' | 'stocks' | 'deposits' | 'selection' | 'selectionInvested';

export interface ChartLine {
  key: ChartLineKey;
  label: string;
  data: number[];
}

/** Lopend totaal → stroom per periode (verschil met het vorige punt); de eerste is 0. */
function stepFlows(cumulative: number[]): number[] {
  return cumulative.map((c, i) => (i === 0 ? 0 : c - cumulative[i - 1]));
}

/** € → de waarden zelf; % → tijdgewogen rendement met de stappen van `cumulativeFlows`. */
function series(values: number[], cumulativeFlows: number[], percent: boolean): number[] {
  return percent ? timeWeightedReturns(values, stepFlows(cumulativeFlows)) : values;
}

/** Som over de geselecteerde tickers; een ticker die nog niet in het punt staat telt als 0. */
function sumSelection(
  points: PortfolioPoint[],
  selection: string[],
  field: 'value' | 'invested',
): number[] {
  return points.map(p => selection.reduce((sum, t) => sum + (p.by_ticker[t]?.[field] ?? 0), 0));
}

export function buildChartLines(
  points: PortfolioPoint[],
  selection: string[] | null,
  selectionLabel: string,
  percent: boolean,
): ChartLine[] {
  if (selection === null) {
    const netDeposits = points.map(p => p.net_deposits);
    // Netto belegd in aandelen (aankopen − verkopen, kosten inbegrepen: een aankoopkost is
    // dus een klein verlies). Totaal: enkel stortingen en opnames brengen geld binnen of
    // buiten; trades verschuiven het alleen tussen cash en aandelen.
    const invested = points.map(p => p.net_deposits - p.cash);
    const lines: ChartLine[] = [
      {
        key: 'total',
        label: 'Totaal',
        data: series(points.map(p => p.total), netDeposits, percent),
      },
      {
        key: 'stocks',
        label: 'Aandelen',
        data: series(points.map(p => p.market_value), invested, percent),
      },
    ];
    if (!percent) lines.push({ key: 'deposits', label: 'Netto stortingen', data: netDeposits });
    return lines;
  }

  const value = sumSelection(points, selection, 'value');
  const invested = sumSelection(points, selection, 'invested');
  const lines: ChartLine[] = [
    { key: 'selection', label: selectionLabel, data: series(value, invested, percent) },
  ];
  if (!percent) lines.push({ key: 'selectionInvested', label: 'Geïnvesteerd', data: invested });
  return lines;
}

/** Bezat de selectie iets in deze punten? Zo niet (alles verkocht vóór het bereik, of pas
 *  later gekocht), dan toont het dashboard een melding in plaats van een vlakke nullijn. */
export function hasSelectionData(points: PortfolioPoint[], selection: string[] | null): boolean {
  if (selection === null) return true;
  const value = sumSelection(points, selection, 'value');
  const invested = sumSelection(points, selection, 'invested');
  return value.some(v => v !== 0) || invested.some(v => v !== invested[0]);
}
