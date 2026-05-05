import { Router } from 'express';
import { z } from 'zod';
import {
  listTrades,
  getTrade,
  insertTrade,
  updateTrade,
  deleteTrade,
} from '../queries/trades';
import { fetchQuote } from '../services/marketData';
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
    const trade = insertTrade(parsed.data);
    // Fire-and-forget: warm the ticker cache so dashboard is fast next time.
    fetchQuote(trade.ticker).catch(() => null);
    res.status(201).json(trade);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const parsed = tradeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid trade', issues: parsed.error.issues });
  }
  const updated = updateTrade(id, parsed.data);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const ok = deleteTrade(parseInt(req.params.id, 10));
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;
