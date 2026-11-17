import express from 'express';
import logger from '../utils/logger.js';
import { isDemoMode } from '../demo/index.js';
import { audit } from '../auth/audit.js';
import { reserveAttempt, releaseAttempt } from '../auth/rateLimit.js';
import { getAuthConfig } from '../auth/config.js';
import { getQuoteResponseView, submitQuoteResponse, QuoteResponseError } from '../services/quoteResponseService.js';
import { sendQuoteResponseNotification } from '../services/authMailService.js';

// Öffentlich (PUBLIC_API_PATHS): Kunde nimmt ein Angebot per Mail-Link an oder lehnt es ab.
const router = express.Router();

const RATE_LIMIT = { limit: 20, windowMs: 15 * 60 * 1000 };
const ipKey = (req) => `quoteresponse:ip:${req.ip}`;

router.use((req, res, next) => {
  if (isDemoMode()) return res.status(403).json({ error: 'In der Demo deaktiviert', code: 'DEMO_DISABLED' });
  next();
});

router.get('/:token', async (req, res) => {
  try {
    res.json(await getQuoteResponseView(req.params.token));
  } catch (error) {
    logger.error('Error loading quote response link:', error);
    res.status(500).json({ error: 'Der Link konnte nicht geladen werden.' });
  }
});

async function notifyCompany(result) {
  try {
    if (!result.company.email) return;
    await sendQuoteResponseNotification(result.company.email, {
      quoteNumber: result.quote.quoteNumber,
      customerName: result.quote.customerName,
      decision: result.decision,
      responderName: result.name,
      comment: result.comment,
      link: `${getAuthConfig().publicUrl.replace(/\/+$/, '')}/#quotes`,
    });
  } catch (error) {
    logger.error('Benachrichtigung über Angebotsantwort fehlgeschlagen', { error: error?.message });
  }
}

router.post('/:token', async (req, res) => {
  try {
    const key = ipKey(req);
    const retryAfter = await reserveAttempt(key, RATE_LIMIT.limit, RATE_LIMIT.windowMs);
    if (retryAfter > 0) {
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Zu viele Versuche. Bitte später erneut versuchen.', code: 'RATE_LIMITED' });
    }

    const result = await submitQuoteResponse(req.params.token, req.body, { ip: req.ip, userAgent: req.get('user-agent') });
    await releaseAttempt(key);
    await audit(req, {
      action: result.decision === 'accepted' ? 'quote.customer_accepted' : 'quote.customer_rejected',
      user: { name: `Kunde: ${result.name}` },
      entityType: 'quotes',
      entityId: result.quote.id,
      details: { quoteNumber: result.quote.quoteNumber },
    });
    res.json({ status: 'answered', decision: result.decision });
    notifyCompany(result);
    return undefined;
  } catch (error) {
    if (error instanceof QuoteResponseError) return res.status(error.httpStatus).json(error.body);
    logger.error('Error submitting quote response:', error);
    return res.status(500).json({ error: 'Die Antwort konnte nicht gespeichert werden.' });
  }
});

export default router;
