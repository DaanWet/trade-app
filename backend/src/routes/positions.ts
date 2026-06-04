import { Router } from 'express';
import { computeAllPositions, totalsOf, allRealizedLots, sharesHeld } from '../services/positionsCalc';
import { computeCashSummary } from '../services/cashService';
import { buildPortfolioHistory } from '../services/portfolioHistory';
import { errorMessage } from '../helpers/errors';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    // Independent: live quotes (slow) and the cash summary run concurrently.
    const [positions, cash] = await Promise.all([computeAllPositions(), computeCashSummary()]);
    const base = totalsOf(positions);

    // Allocation splits the positive parts only, so negative cash collapses to
    // 0% cash / 100% stocks and the bar always sums to 100 — no special-casing
    // needed in the view. net_worth still reflects the true (possibly negative) total.
    const stockVal = Math.max(base.market_value, 0);
    const cashVal = Math.max(cash.cash_balance, 0);
    const denom = stockVal + cashVal;
    const totals = {
      ...base,
      cash_balance: cash.cash_balance,
      net_worth: base.market_value + cash.cash_balance,
      cash_pct: denom > 0 ? (cashVal / denom) * 100 : 0,
      invested_pct: denom > 0 ? (stockVal / denom) * 100 : 0,
    };
    res.json({ positions, totals });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

/**
 * Open shares held for a ticker (cheap: DB-only, no live quotes). Lets the trade-form
 * show how many shares can be sold and validate before submitting. `date` caps the
 * walk to that day (inclusive); `excludeTradeId` ignores one trade (when editing it).
 */
router.get('/holdings', (req, res) => {
  const ticker = typeof req.query.ticker === 'string' ? req.query.ticker.trim() : '';
  if (!ticker) return res.status(400).json({ error: 'ticker is required' });
  const asOf = typeof req.query.date === 'string' ? req.query.date : undefined;
  const excludeId = typeof req.query.excludeTradeId === 'string' ? parseInt(req.query.excludeTradeId, 10) : undefined;
  try {
    const shares_held = sharesHeld(ticker, {
      asOf,
      excludeTradeId: Number.isNaN(excludeId) ? undefined : excludeId,
    });
    res.json({ ticker, shares_held });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/realized', (_req, res) => {
  try {
    res.json(allRealizedLots());
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/history', async (_req, res) => {
  try {
    res.json(await buildPortfolioHistory());
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
