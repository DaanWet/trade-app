/**
 * Tijdgewogen rendement (TWR) — voedt de %-weergave van de portefeuillegrafiek.
 *
 * Een gewone herbasering (`v / eerste − 1`) telt nieuw geld als winst: een storting laat
 * het totaal stijgen, een aankoop de aandelenlijn. TWR knipt de reeks in periodes tussen
 * opeenvolgende punten, haalt de geldstroom uit elke periode en stapelt de rendementen.
 *
 * Puur en zonder Angular: dezelfde functie dient voor elke reeks waarvan je waarde en
 * in- of uitstroom kent (totaal + stortingen, aandelen + belegd, later een tickerselectie).
 */

/** Noemers kleiner dan dit (in munteenheden) zijn afrondingsruis, geen belegd vermogen. */
const EPSILON = 1e-6;

/**
 * Cumulatief tijdgewogen rendement per punt, in procentpunten (1.2 = +1,2 %); het eerste
 * punt is altijd 0.
 *
 * @param values waarde op elk punt
 * @param flows  netto in- (+) of uitstroom (−) tussen punt i−1 en i; flows[0] telt niet mee
 *               (alles vóór het eerste punt zit al in de beginwaarde)
 *
 * Per periode: `r = (V_i − V_{i−1} − F_i) / (V_{i−1} + max(F_i, 0))`. Instroom werkt de hele
 * periode mee (een aankoop of storting staat er vanaf het begin), uitstroom pas aan het eind
 * (verkocht of opgenomen geld heeft de periode nog meegemaakt). Uitstroom aan het begin
 * aftrekken laat een volledige verkoop ontsporen: de noemer krimpt dan tot het verschil tussen
 * vorige slotkoers en verkoopprijs en het rendement wordt −100 % — voorgoed, want elke latere
 * periode vermenigvuldigt met 0. Een noemer van (bijna) 0 of minder — niets in bezit en niets
 * ingebracht — telt als 0 %, zodat er nooit NaN of Infinity uitkomt.
 */
export function timeWeightedReturns(values: number[], flows: number[]): number[] {
  const out: number[] = [];
  let growth = 1;
  for (let i = 0; i < values.length; i++) {
    if (i > 0) {
      const prev = values[i - 1];
      const flow = flows[i] ?? 0;
      const base = prev + Math.max(flow, 0);
      const r = base > EPSILON ? (values[i] - prev - flow) / base : 0;
      growth *= 1 + r;
    }
    out.push((growth - 1) * 100);
  }
  return out;
}
