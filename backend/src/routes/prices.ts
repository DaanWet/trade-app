import { Router } from 'express';
import { fetchQuote, fetchQuotes, fetchHistorical, searchSymbol, priceAt } from '../services/marketData';
import { getRate } from '../services/fxService';
import { errorMessage } from '../helpers/errors';

const router = Router();

router.get('/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  res.json(await searchSymbol(q));
});

router.get('/quote/:symbol', async (req, res) => {
  try {
    const force = req.query.force === '1';
    const quote = await fetchQuote(req.params.symbol, { force });
    if (!quote) return res.status(404).json({ error: 'Symbol not found' });
    res.json(quote);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/quotes', async (req, res) => {
  try {
    const symbols = Array.isArray(req.body?.symbols) ? (req.body.symbols as string[]) : [];
    res.json(await fetchQuotes(symbols, { force: req.body?.force === true }));
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/at/:symbol', async (req, res) => {
  try {
    const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const result = await priceAt(req.params.symbol, date);
    if (!result) return res.status(404).json({ error: 'No price available for that symbol/date' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/historical/:symbol', async (req, res) => {
  try {
    const from = req.query.from
      ? new Date(req.query.from as string)
      : (() => {
          const d = new Date();
          d.setFullYear(d.getFullYear() - 1);
          return d;
        })();
    const to = req.query.to ? new Date(req.query.to as string) : new Date();
    res.json(await fetchHistorical(req.params.symbol, from, to));
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/fx', async (req, res) => {
  try {
    const from = (req.query.from as string)?.toUpperCase();
    const to = (req.query.to as string)?.toUpperCase();
    if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
    const date = (req.query.date as string) || undefined;
    res.json({ from, to, date: date ?? new Date().toISOString().slice(0, 10), rate: await getRate(from, to, date) });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
