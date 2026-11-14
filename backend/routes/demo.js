import express from 'express';
import { isDemoMode, nextResetAt, DEMO_EMAIL, DEMO_PASSWORD } from '../demo/index.js';

const router = express.Router();

// Öffentlich (Login-Seite): ohne Demo-Modus nur { demo: false }.
router.get('/', (req, res) => {
  if (!isDemoMode()) return res.json({ demo: false });
  res.json({
    demo: true,
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    nextResetAt: nextResetAt(new Date()).toISOString(),
  });
});

export default router;
