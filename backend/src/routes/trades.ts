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
import { projectCashAfterTrade, cashShortfallMessage, type TradeCashFields } from '../services/cashService';
import { findShareOverdraw, shareShortfallMessage, type TradeShareFields } from '../services/positionsCalc';
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
 * Build a 409 CASH_OVERDRAW body when a trade change would push the cash balance
 * negative and the client hasn't acknowledged it with `?confirm=1`; otherwise null.
 * `next` is null when deleting. Pure — the route decides how to respond.
 */
async function cashOverdrawWarning(
  confirmed: boolean,
  next: TradeCashFields | null,
  previous?: TradeRow | null,
) {
  if (confirmed) return null;
  const { cash_balance, projected, overdraws } = await projectCashAfterTrade(next, previous);
  if (!overdraws) return null;
  return {
    code: 'CASH_OVERDRAW',
    error: cashShortfallMessage(next ? 'trade' : 'verwijdering', projected, cash_balance),
    cash_balance,
    projected,
  };
}

/** Map a validated trade payload to the fields the cash projection needs. */
function tradeCashFields(input: z.infer<typeof tradeSchema>): TradeCashFields {
  return { ...input, fees: input.fees ?? 0 };
}

/** Map a validated trade payload to the fields the FIFO share projection needs. */
function tradeShareFields(input: z.infer<typeof tradeSchema>): TradeShareFields {
  return {
    ticker: input.ticker,
    trade_date: input.trade_date,
    side: input.side,
    shares: input.shares,
    price: input.price,
    currency: input.currency,
    fees: input.fees ?? 0,
  };
}

/**
 * Build a 400 INSUFFICIENT_SHARES body when a trade change would close more shares
 * than are held at some point in the (chronological) history; otherwise null. Unlike
 * the cash overdraw this is a hard block — there is no `?confirm=1` bypass. `next` is
 * null when deleting. Pure — the route decides how to respond.
 */
function insufficientSharesError(next: TradeShareFields | null, previous?: TradeRow | null) {
  const overdraw = findShareOverdraw(next, previous);
  if (!overdraw) return null;
  return { code: 'INSUFFICIENT_SHARES', error: shareShortfallMessage(overdraw), ...overdraw };
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
    const shortfall = insufficientSharesError(tradeShareFields(parsed.data), null);
    if (shortfall) return res.status(400).json(shortfall);
    const overdraw = await cashOverdrawWarning(req.query.confirm === '1', tradeCashFields(parsed.data));
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
    const shortfall = insufficientSharesError(tradeShareFields(parsed.data), previous);
    if (shortfall) return res.status(400).json(shortfall);
    const overdraw = await cashOverdrawWarning(req.query.confirm === '1', tradeCashFields(parsed.data), previous);
    if (overdraw) return res.status(409).json(overdraw);
    const updated = updateTrade(id, parsed.data);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const previous = getTrade(id);
    if (!previous) return res.status(404).json({ error: 'Not found' });
    // Deleting a BUY removes its shares and can leave later SELLs uncovered → hard block.
    const shortfall = insufficientSharesError(null, previous);
    if (shortfall) return res.status(400).json(shortfall);
    // Deleting a SELL removes its proceeds and can drive cash negative → soft confirm.
    const overdraw = await cashOverdrawWarning(req.query.confirm === '1', null, previous);
    if (overdraw) return res.status(409).json(overdraw);
    deleteTrade(id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
