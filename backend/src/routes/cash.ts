import { Router } from 'express';
import { z } from 'zod';
import {
  listCashTx,
  getCashTx,
  insertCashTx,
  updateCashTx,
  deleteCashTx,
} from '../queries/cash';
import {
  computeCashSummary,
  projectCashAfterCashTx,
  cashShortfallMessage,
  type CashTxCashFields,
} from '../services/cashService';
import { errorMessage } from '../helpers/errors';

const router = Router();

const cashSchema = z.object({
  type: z.enum(['DEPOSIT', 'WITHDRAWAL']),
  amount: z.number().positive(),
  currency: z.string().length(3),
  tx_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  notes: z.string().nullable().optional(),
});

/**
 * Build a 400 body when a cash change would push the balance negative; otherwise null.
 * Unlike trades (a soft confirm), the cash ledger is hard-blocked: you cannot withdraw
 * (or delete a deposit / shrink it) below what's available.
 */
async function cashOverdrawError(
  next: CashTxCashFields | null,
  previous?: CashTxCashFields | null,
) {
  const { cash_balance, projected, overdraws } = await projectCashAfterCashTx(next, previous);
  if (!overdraws) return null;
  return {
    error: cashShortfallMessage('wijziging', projected, cash_balance),
    cash_balance,
    projected,
  };
}

router.get('/', async (_req, res) => {
  try {
    const transactions = listCashTx();
    const summary = await computeCashSummary();
    res.json({ transactions, summary });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/:id', (req, res) => {
  const tx = getCashTx(parseInt(req.params.id, 10));
  if (!tx) return res.status(404).json({ error: 'Not found' });
  res.json(tx);
});

router.post('/', async (req, res) => {
  const parsed = cashSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid cash transaction', issues: parsed.error.issues });
  }
  try {
    const overdraw = await cashOverdrawError(parsed.data);
    if (overdraw) return res.status(400).json(overdraw);
    res.status(201).json(insertCashTx(parsed.data));
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const parsed = cashSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid cash transaction', issues: parsed.error.issues });
  }
  try {
    const previous = getCashTx(id);
    if (!previous) return res.status(404).json({ error: 'Not found' });
    const overdraw = await cashOverdrawError(parsed.data, previous);
    if (overdraw) return res.status(400).json(overdraw);
    const updated = updateCashTx(id, parsed.data);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const previous = getCashTx(id);
    if (!previous) return res.status(404).json({ error: 'Not found' });
    // Deleting a deposit lowers cash; block it if that would overdraw.
    const overdraw = await cashOverdrawError(null, previous);
    if (overdraw) return res.status(400).json(overdraw);
    deleteCashTx(id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
