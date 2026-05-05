import { Router } from 'express';
import { computeTaxReport, listRealizedLotsForTax, DEFAULT_TAX_PARAMS } from '../services/taxCalc';
import { errorMessage } from '../helpers/errors';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    res.json({
      params: DEFAULT_TAX_PARAMS,
      years: await computeTaxReport(),
    });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/lots', async (_req, res) => {
  try {
    res.json(await listRealizedLotsForTax());
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
