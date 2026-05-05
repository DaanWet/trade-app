import { Router } from 'express';
import { z } from 'zod';
import { getAllSettings, getSetting, upsertSetting } from '../helpers/settings';
import { SETTING_KEYS } from '../helpers/constants';

const router = Router();

router.get('/', (_req, res) => res.json(getAllSettings()));

router.get('/:key', (req, res) => {
  const value = getSetting(req.params.key);
  if (value == null) return res.status(404).json({ error: 'Setting not found' });
  res.json({ key: req.params.key, value });
});

const settingsSchema = z.object({
  [SETTING_KEYS.DISPLAY_CURRENCY]: z.string().length(3).optional(),
}).passthrough();

router.put('/', (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid settings', issues: parsed.error.issues });
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v != null) upsertSetting(k, String(v));
  }
  res.json(getAllSettings());
});

export default router;
