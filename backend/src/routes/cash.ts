import { Router } from 'express';
import { z } from 'zod';
import {
  listCashTx,
  getCashTx,
  insertCashTx,
  updateCashTx,
  deleteCashTx,
} from '../queries/cash';
import { computeCashSummary } from '../services/cashService';
import { errorMessage } from '../helpers/errors';

const router = Router();

const cashSchema = z.object({
  type: z.enum(['DEPOSIT', 'WITHDRAWAL']),
  amount: z.number().positive(),
  currency: z.string().length(3),
  tx_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  notes: z.string().nullable().optional(),
});

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

router.post('/', (req, res) => {
  const parsed = cashSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid cash transaction', issues: parsed.error.issues });
  }
  try {
    res.status(201).json(insertCashTx(parsed.data));
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const parsed = cashSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid cash transaction', issues: parsed.error.issues });
  }
  const updated = updateCashTx(id, parsed.data);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const ok = deleteCashTx(parseInt(req.params.id, 10));
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;
