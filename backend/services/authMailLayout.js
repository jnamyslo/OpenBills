import { escapeHtml } from './emailService.js';

const DEFAULT_PRIMARY = '#2563eb';
const DEFAULT_SECONDARY = '#64748b';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const color = (value, fallback) => (HEX_COLOR.test(value ?? '') ? value : fallback);

/**
 * HTML für Systemmails (Einladung, Passwort-Reset) im Layout der Rechnungsmails.
 * Alle Texte werden escaped; Farben nur als #rrggbb übernommen.
 */
export function renderAuthMail({ heading, paragraphs, buttonLabel, link, note, companyName, primaryColor, secondaryColor }) {
  const primary = color(primaryColor, DEFAULT_PRIMARY);
  const secondary = color(secondaryColor, DEFAULT_SECONDARY);
  const safeLink = escapeHtml(link);
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, ${primary} 0%, ${secondary} 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
    .content { background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
    .button-wrap { text-align: center; margin: 30px 0; }
    .button { display: inline-block; background: ${primary}; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; }
    .link { word-break: break-all; font-size: 13px; color: #6b7280; }
    .info-box { background: #dbeafe; border-left: 4px solid ${primary}; padding: 15px 20px; margin: 20px 0; border-radius: 4px; }
    .footer { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none; text-align: center; font-size: 14px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(heading)}</h1>
  </div>
  <div class="content">
    ${paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('\n    ')}
    <div class="button-wrap">
      <a class="button" href="${safeLink}">${escapeHtml(buttonLabel)}</a>
    </div>
    <p class="link">Falls der Button nicht funktioniert, diesen Link im Browser öffnen:<br>${safeLink}</p>
    <div class="info-box">
      <p style="margin: 0;">${escapeHtml(note)}</p>
    </div>
  </div>
  <div class="footer">
    <p style="margin: 0;"><strong>${escapeHtml(companyName || 'OpenBills')}</strong></p>
    <p style="margin: 5px 0 0 0;">Versendet über OpenBills</p>
  </div>
</body>
</html>`;
}
