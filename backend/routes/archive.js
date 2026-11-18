import express from 'express';
import logger from '../utils/logger.js';
import { audit } from '../auth/audit.js';
import { archiveDocument, listArchive, getArchiveFile, countMissing } from '../services/archiveService.js';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { documentType, documentId, format, filename, contentType, content, source = 'output', reminderStage } = req.body ?? {};
    const result = await archiveDocument(null, {
      documentType, documentId, format, filename, contentType, contentBase64: content, source, reminderStage, userId: req.user?.id ?? null,
    });
    res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    if ([400, 404, 409].includes(error.statusCode)) return res.status(error.statusCode).json({ error: error.message });
    logger.error('Fehler beim Archivieren:', error);
    res.status(500).json({ error: 'Fehler beim Archivieren' });
  }
});

router.get('/', async (req, res) => {
  try {
    const { documentType, documentId } = req.query;
    res.json(await listArchive({
      documentType: typeof documentType === 'string' ? documentType : undefined,
      documentId: typeof documentId === 'string' ? documentId : undefined,
    }));
  } catch (error) {
    logger.error('Fehler beim Laden des Archivs:', error);
    res.status(500).json({ error: 'Fehler beim Laden des Archivs' });
  }
});

router.get('/missing', async (req, res) => {
  try {
    res.json(await countMissing());
  } catch (error) {
    logger.error('Fehler beim Prüfen fehlender Archivfassungen:', error);
    res.status(500).json({ error: 'Fehler beim Prüfen fehlender Archivfassungen' });
  }
});

router.get('/:id/download', async (req, res) => {
  try {
    const file = await getArchiveFile(req.params.id);
    if (!file) return res.status(404).json({ error: 'Archivfassung nicht gefunden' });
    await audit(req, {
      action: 'archive.downloaded',
      entityType: file.documentType,
      entityId: file.id,
      details: { documentNumber: file.documentNumber, format: file.format },
    });
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    res.send(file.content);
  } catch (error) {
    logger.error('Fehler beim Download der Archivfassung:', error);
    res.status(500).json({ error: 'Fehler beim Download der Archivfassung' });
  }
});

export default router;
