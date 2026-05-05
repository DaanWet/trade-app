import { Router } from 'express';
import { computeAllPositions, totalsOf, allRealizedLots } from '../services/positionsCalc';
import { buildPortfolioHistory } from '../services/portfolioHistory';
import { errorMessage } from '../helpers/errors';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const positions = await computeAllPositions();
    const totals = totalsOf(positions);
    res.json({ positions, totals });
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
