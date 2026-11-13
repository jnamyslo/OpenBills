import express from 'express';
import logger from '../utils/logger.js';
import { getPlan, getPlanName, getUpgradeContact } from '../utils/plan.js';
import { getUsage } from '../services/quotaService.js';

const router = express.Router();

// Aktueller Plan, Limits und Nutzung im laufenden Monat
router.get('/', async (req, res) => {
  try {
    const plan = getPlan();
    res.json({
      plan: getPlanName(),
      label: plan.label,
      features: plan.features,
      limits: plan.limits,
      usage: await getUsage(),
      upgradeContact: getUpgradeContact(),
    });
  } catch (error) {
    logger.error('Failed to fetch plan', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch plan' });
  }
});

export default router;
