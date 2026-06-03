import { Router } from 'express';
import { z } from 'zod';
import {
  listTrades,
  getTrade,
  insertTrade,
  updateTrade,
  deleteTrade,
  type TradeRow,
} from '../queries/trades';
import { fetchQuote } from '../services/marketData';
import { projectCashAfterTrade, cashShortfallMessage } from '../services/cashService';
import { errorMessage } from '../helpers/errors';

const router = Router();

const tradeSchema = z.object({
  ticker: z.string().min(1).max(20),
  trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  side: z.enum(['BUY', 'SELL']),
  shares: z.number().positive(),
  price: z.number().nonnegative(),
  currency: z.string().length(3),
  fees: z.number().nonnegative().optional(),
  notes: z.string().nullable().optional(),
});

/**
 * Build a 409 CASH_OVERDRAW body when this trade would push the cash balance
 * negative and the client hasn't acknowledged it with `?confirm=1`; otherwise null.
 * Pure — the route decides how to respond.
 */
async function cashOverdrawWarning(
  input: z.infer<typeof tradeSchema>,
  confirmed: boolean,
  previous?: TradeRow | null,
) {
  if (confirmed) return null;
  const { cash_balance, projected, overdraws } = await projectCashAfterTrade(
    { ...input, fees: input.fees ?? 0 },
    previous,
  );
  if (!overdraws) return null;
  return {
    code: 'CASH_OVERDRAW',
    error: cashShortfallMessage('trade', projected, cash_balance),
    cash_balance,
    projected,
  };
}

router.get('/', (req, res) => {
  const ticker = typeof req.query.ticker === 'string' ? req.query.ticker : undefined;
  res.json(listTrades(ticker ? { ticker } : undefined));
});

router.get('/:id', (req, res) => {
  const trade = getTrade(parseInt(req.params.id, 10));
  if (!trade) return res.status(404).json({ error: 'Not found' });
  res.json(trade);
});

router.post('/', async (req, res) => {
  const parsed = tradeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid trade', issues: parsed.error.issues });
  }
  try {
    const overdraw = await cashOverdrawWarning(parsed.data, req.query.confirm === '1');
    if (overdraw) return res.status(409).json(overdraw);
    const trade = insertTrade(parsed.data);
    // Fire-and-forget: warm the ticker cache so dashboard is fast next time.
    fetchQuote(trade.ticker).catch(() => null);
    res.status(201).json(trade);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const parsed = tradeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid trade', issues: parsed.error.issues });
  }
  try {
    const previous = getTrade(id);
    if (!previous) return res.status(404).json({ error: 'Not found' });
    const overdraw = await cashOverdrawWarning(parsed.data, req.query.confirm === '1', previous);
    if (overdraw) return res.status(409).json(overdraw);
    const updated = updateTrade(id, parsed.data);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.delete('/:id', (req, res) => {
  const ok = deleteTrade(parseInt(req.params.id, 10));
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;
