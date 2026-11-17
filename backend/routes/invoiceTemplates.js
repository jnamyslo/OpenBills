import express from 'express';
import { query } from '../database.js';
import logger from '../utils/logger.js';

const router = express.Router();

const MAX_TEMPLATES = 200;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Ersetzt die Rechnungsvorlagen der Firma (nur diese Spalte).
router.put('/', async (req, res) => {
  const templates = req.body?.invoiceTemplates;
  if (!Array.isArray(templates) || templates.length > MAX_TEMPLATES || !templates.every(isPlainObject)) {
    return res.status(400).json({ error: `invoiceTemplates muss eine Liste von höchstens ${MAX_TEMPLATES} Vorlagen sein` });
  }
  try {
    const { rows } = await query(
      'UPDATE company SET invoice_templates = $1::jsonb WHERE id = 1 RETURNING invoice_templates',
      [JSON.stringify(templates)]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Firmendaten nicht gefunden' });
    return res.json(rows[0].invoice_templates);
  } catch (error) {
    logger.error('Error updating invoice templates:', error);
    return res.status(500).json({ error: 'Rechnungsvorlagen konnten nicht gespeichert werden' });
  }
});

export default router;
