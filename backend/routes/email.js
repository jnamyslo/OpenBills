import express from 'express';
import { query } from '../database.js';
import { sendInvoiceEmail, sendInvoiceEmailMultiFormat, sendReminderEmail, testEmailConnection } from '../services/emailService.js';
import logger from '../utils/logger.js';
import { stampDraftWatermark } from '../utils/draftWatermark.js';

const router = express.Router();

const DRAFT_XRECHNUNG_MESSAGE = 'Entwürfe können nicht als XRechnung versendet werden. Bitte die Rechnung zuerst freigeben.';

/** Status aus der DB – die vom Client gesendeten invoiceData sind nicht vertrauenswürdig. */
async function loadInvoiceStatus(invoiceId) {
  if (!invoiceId) return null;
  const result = await query('SELECT status FROM invoices WHERE id = $1', [invoiceId]);
  return result.rows[0]?.status ?? null;
}

// Test email configuration
router.get('/test', async (req, res) => {
  try {
    const result = await testEmailConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Fehler beim Testen der E-Mail-Konfiguration',
      error: error.message 
    });
  }
});

// Send invoice via email with multiple formats
router.post('/send-invoice-multi', async (req, res) => {
  try {
    const { customerEmails, invoiceFormats, invoiceData, customText, attachments } = req.body;
    
    if (!customerEmails || !Array.isArray(customerEmails) || customerEmails.length === 0 || !invoiceFormats || !Array.isArray(invoiceFormats) || !invoiceData) {
      return res.status(400).json({ 
        success: false, 
        message: 'Fehlende Parameter: customerEmails (Array), invoiceFormats und invoiceData sind erforderlich' 
      });
    }

    // Get company settings for styling
    const companyResult = await query('SELECT primary_color, secondary_color FROM company WHERE id = 1');
    const companySettings = companyResult.rows[0] || { primary_color: '#2563eb', secondary_color: '#64748b' };

    const status = await loadInvoiceStatus(invoiceData.id);
    if (!status) {
      return res.status(404).json({ success: false, message: 'Rechnung nicht gefunden' });
    }
    const isDraft = status === 'draft';
    if (isDraft && invoiceFormats.some(f => f.format === 'xrechnung')) {
      return res.status(400).json({ success: false, message: DRAFT_XRECHNUNG_MESSAGE });
    }

    // Convert base64 PDFs to buffers; Entwürfe erhalten serverseitig das Wasserzeichen
    const processedFormats = await Promise.all(invoiceFormats.map(async ({ format, content }) => {
      const buffer = Buffer.from(content, 'base64');
      return { format, content: isDraft ? await stampDraftWatermark(buffer) : buffer };
    }));
    
    // Process additional attachments if provided
    let processedAttachments = [];
    if (attachments && Array.isArray(attachments)) {
      processedAttachments = attachments.map(attachment => ({
        name: attachment.name,
        content: attachment.content, // Already base64
        contentType: attachment.contentType || 'application/octet-stream'
      }));
    }

    // Send to all recipients
    const results = [];
    for (const email of customerEmails) {
      try {
        const result = await sendInvoiceEmailMultiFormat(email, processedFormats, invoiceData, customText, processedAttachments, companySettings);
        results.push({ email, success: true, messageId: result.messageId });
      } catch (error) {
        logger.error(`Error sending to ${email}:`, error);
        results.push({ email, success: false, error: error.message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    res.json({
      success: successCount > 0,
      message: `Rechnung versendet: ${successCount} erfolgreich, ${failureCount} fehlgeschlagen`,
      results,
      successCount,
      failureCount
    });
    
  } catch (error) {
    logger.error('Fehler beim E-Mail-Versand:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Fehler beim E-Mail-Versand',
      error: error.message 
    });
  }
});

// Send invoice via email
router.post('/send-invoice', async (req, res) => {
  try {
    const { customerEmail, invoicePDF, invoiceData, format = 'standard', customText, attachments } = req.body;
    
    if (!customerEmail || !invoicePDF || !invoiceData) {
      return res.status(400).json({ 
        success: false, 
        message: 'Fehlende Parameter: customerEmail, invoicePDF und invoiceData sind erforderlich' 
      });
    }

    // Get company settings for styling
    const companyResult = await query('SELECT primary_color, secondary_color FROM company WHERE id = 1');
    const companySettings = companyResult.rows[0] || { primary_color: '#2563eb', secondary_color: '#64748b' };

    const status = await loadInvoiceStatus(invoiceData.id);
    if (!status) {
      return res.status(404).json({ success: false, message: 'Rechnung nicht gefunden' });
    }
    const isDraft = status === 'draft';
    if (isDraft && format === 'xrechnung') {
      return res.status(400).json({ success: false, message: DRAFT_XRECHNUNG_MESSAGE });
    }

    // Convert base64 PDF to buffer; Entwürfe erhalten serverseitig das Wasserzeichen
    const rawPdf = Buffer.from(invoicePDF, 'base64');
    const pdfBuffer = isDraft ? await stampDraftWatermark(rawPdf) : rawPdf;
    
    // Process additional attachments if provided
    let processedAttachments = [];
    if (attachments && Array.isArray(attachments)) {
      processedAttachments = attachments.map(attachment => ({
        name: attachment.name,
        content: attachment.content, // Already base64
        contentType: attachment.contentType || 'application/octet-stream'
      }));
    }
    
    const result = await sendInvoiceEmail(customerEmail, pdfBuffer, invoiceData, format, customText, processedAttachments, companySettings);
    
    res.json({
      success: true,
      message: 'Rechnung erfolgreich per E-Mail versendet',
      messageId: result.messageId
    });
    
  } catch (error) {
    logger.error('Fehler beim E-Mail-Versand:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Fehler beim E-Mail-Versand',
      error: error.message 
    });
  }
});

// Send reminder email
router.post('/send-reminder', async (req, res) => {
  try {
    const { customerEmails, reminderPDF, invoiceData, stage, fee, customText, additionalAttachments } = req.body;
    
    if (!customerEmails || !Array.isArray(customerEmails) || customerEmails.length === 0 || !reminderPDF || !invoiceData || !stage) {
      return res.status(400).json({ 
        success: false, 
        message: 'Fehlende Parameter: customerEmails (Array), reminderPDF, invoiceData und stage sind erforderlich' 
      });
    }

    // Get company settings for styling
    const companyResult = await query('SELECT primary_color, secondary_color FROM company WHERE id = 1');
    const companySettings = companyResult.rows[0] || { primary_color: '#2563eb', secondary_color: '#64748b' };

    const result = await sendReminderEmail(
      customerEmails, 
      reminderPDF, 
      invoiceData, 
      stage, 
      fee || 0, 
      customText, 
      companySettings,
      additionalAttachments || []
    );
    
    res.json(result);
    
  } catch (error) {
    logger.error('Fehler beim Mahnungs-Versand:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Fehler beim Mahnungs-Versand',
      error: error.message 
    });
  }
});

export default router;
