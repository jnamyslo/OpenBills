import express from 'express';
import { pool } from '../database.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { audit } from '../auth/audit.js';
import { BACKUP_TABLES } from '../utils/backupTables.js';
import { encryptBackup, decryptBackup, validatePassphrase, BackupPassphraseError } from '../utils/backupCrypto.js';
import { encryptSmtpPass, decryptSmtpPass } from '../utils/smtpPassword.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backupDir = path.join(__dirname, '../../backups');
const ZIP_FILENAME = /^vollbackup_[\d-T:Z]+\.zip$/;

// Define JSONB columns for each table that need special handling during restore
const JSONB_COLUMNS = {
  'email_history': ['attachments', 'smtp_response'],
  'job_entries': ['materials', 'signature'],
  'company': ['payment_methods', 'invoice_templates']
};

// Function to process values for JSONB columns
function processValueForRestore(table, column, value) {
  // Im Backup steht das SMTP-Passwort im Klartext; in der DB mit dem Schlüssel dieser Instanz.
  if (table === 'smtp_settings' && column === 'smtp_pass') {
    return encryptSmtpPass(value);
  }

  if (JSONB_COLUMNS[table] && JSONB_COLUMNS[table].includes(column)) {
    // For JSONB columns, ensure the value is properly handled
    if (value === null || value === undefined) {
      return null;
    }

    // If it's already an object/array, stringify it for JSONB
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    // If it's a string, check if it's valid JSON
    if (typeof value === 'string') {
      try {
        // Try to parse it to validate JSON
        JSON.parse(value);
        return value; // It's already a valid JSON string
      } catch {
        // If parsing fails, treat it as a plain string and wrap in JSON
        return JSON.stringify(value);
      }
    }

    // For other types, stringify them
    return JSON.stringify(value);
  }

  // For non-JSONB columns, return the value as-is
  return value;
}

async function readTables(client) {
  const data = {};
  for (const table of BACKUP_TABLES) {
    const result = await client.query(`SELECT * FROM ${client.escapeIdentifier(table)}`);
    data[table] = result.rows;
  }
  // Klartext ins (verschlüsselte) Backup, damit es auch mit anderem AUTH_ENCRYPTION_KEY wiederherstellbar ist
  data.smtp_settings = data.smtp_settings.map((row) => ({ ...row, smtp_pass: decryptSmtpPass(row.smtp_pass) }));
  return data;
}

// Nach dem Einfügen mit expliziten IDs stehen Serial-Sequenzen sonst noch auf dem alten Wert
// (frische Instanz: 1) und der nächste INSERT scheitert am Primärschlüssel.
async function resetSequences(client) {
  for (const table of BACKUP_TABLES) {
    const { rows } = await client.query('SELECT pg_get_serial_sequence($1, $2) AS seq', [table, 'id']);
    if (!rows[0].seq) continue;
    await client.query(
      `SELECT setval($1, COALESCE((SELECT MAX(id) FROM ${client.escapeIdentifier(table)}), 0) + 1, false)`,
      [rows[0].seq]
    );
  }
}

async function runCompatibilityFixes(client) {
  logger.info('Running post-restore compatibility fixes...');
  
  // Fix invoice_items without proper order values (from old backups)
  try {
    const missingOrderResult = await client.query(`
      SELECT COUNT(*) as count FROM invoice_items WHERE item_order IS NULL OR item_order = 0
    `);
    
    const missingOrderCount = parseInt(missingOrderResult.rows[0].count);
    if (missingOrderCount > 0) {
      logger.info(`Fixing ${missingOrderCount} invoice items without proper order values...`);
      
      // Update items to have sequential order values per invoice
      await client.query(`
        UPDATE invoice_items 
        SET item_order = subq.row_number
        FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY invoice_id ORDER BY id) as row_number
          FROM invoice_items
          WHERE item_order IS NULL OR item_order = 0
        ) subq
        WHERE invoice_items.id = subq.id
      `);
      
      logger.info(`Fixed order values for ${missingOrderCount} invoice items`);
    }
  } catch (error) {
    logger.warn('Warning: Could not fix invoice item order values:', error.message);
  }

  // Fix missing discount fields in invoice_items (from old backups without discount support)
  try {
    const missingDiscountResult = await client.query(`
      SELECT COUNT(*) as count FROM invoice_items WHERE discount_type IS NULL AND discount_value IS NULL AND discount_amount IS NULL
    `);
    
    const missingDiscountCount = parseInt(missingDiscountResult.rows[0].count);
    if (missingDiscountCount > 0) {
      logger.info(`Setting default discount values for ${missingDiscountCount} invoice items from old backups...`);
      
      // Set default values for discount fields (no discount)
      await client.query(`
        UPDATE invoice_items 
        SET discount_type = NULL, discount_value = NULL, discount_amount = 0
        WHERE discount_type IS NULL AND discount_value IS NULL AND discount_amount IS NULL
      `);
      
      logger.info(`Fixed discount values for ${missingDiscountCount} invoice items`);
    }
  } catch (error) {
    logger.warn('Warning: Could not fix invoice item discount values:', error.message);
  }

  // Fix missing global discount fields in invoices (from old backups without discount support)
  try {
    const missingGlobalDiscountResult = await client.query(`
      SELECT COUNT(*) as count FROM invoices WHERE global_discount_type IS NULL AND global_discount_value IS NULL AND global_discount_amount IS NULL
    `);
    
    const missingGlobalDiscountCount = parseInt(missingGlobalDiscountResult.rows[0].count);
    if (missingGlobalDiscountCount > 0) {
      logger.info(`Setting default global discount values for ${missingGlobalDiscountCount} invoices from old backups...`);
      
      // Set default values for global discount fields (no discount)
      await client.query(`
        UPDATE invoices 
        SET global_discount_type = NULL, global_discount_value = NULL, global_discount_amount = 0
        WHERE global_discount_type IS NULL AND global_discount_value IS NULL AND global_discount_amount IS NULL
      `);
      
      logger.info(`Fixed global discount values for ${missingGlobalDiscountCount} invoices`);
    }
  } catch (error) {
    logger.warn('Warning: Could not fix invoice global discount values:', error.message);
  }

  // Fix missing discount fields in job_time_entries (from old backups without discount support)
  try {
    const missingJobDiscountResult = await client.query(`
      SELECT COUNT(*) as count FROM job_time_entries WHERE discount_type IS NULL AND discount_value IS NULL AND discount_amount IS NULL
    `);
    
    const missingJobDiscountCount = parseInt(missingJobDiscountResult.rows[0].count);
    if (missingJobDiscountCount > 0) {
      logger.info(`Setting default discount values for ${missingJobDiscountCount} job time entries from old backups...`);
      
      // Set default values for discount fields (no discount)
      await client.query(`
        UPDATE job_time_entries 
        SET discount_type = NULL, discount_value = NULL, discount_amount = 0
        WHERE discount_type IS NULL AND discount_value IS NULL AND discount_amount IS NULL
      `);
      
      logger.info(`Fixed discount values for ${missingJobDiscountCount} job time entries`);
    }
  } catch (error) {
    logger.warn('Warning: Could not fix job time entry discount values:', error.message);
  }

  // Fix missing reminder texts in company (from old backups before reminder system)
  try {
    const missingReminderTextsResult = await client.query(`
      SELECT COUNT(*) as count FROM company 
      WHERE (reminder_text_stage_1 IS NULL OR reminder_text_stage_1 = '')
      OR (reminder_text_stage_2 IS NULL OR reminder_text_stage_2 = '')
      OR (reminder_text_stage_3 IS NULL OR reminder_text_stage_3 = '')
    `);
    
    const missingReminderTextsCount = parseInt(missingReminderTextsResult.rows[0].count);
    if (missingReminderTextsCount > 0) {
      logger.info(`Setting default reminder texts for ${missingReminderTextsCount} company records from old backups...`);
      
      // Set default German reminder texts
      await client.query(`
        UPDATE company 
        SET 
          reminder_text_stage_1 = CASE 
            WHEN reminder_text_stage_1 IS NULL OR reminder_text_stage_1 = '' THEN 
              'Sehr geehrte Damen und Herren,

bei der Durchsicht unserer Unterlagen ist uns aufgefallen, dass die folgende Rechnung noch nicht beglichen wurde. Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.

Wir bitten Sie höflich, den ausstehenden Betrag innerhalb der nächsten 7 Tage zu begleichen.'
            ELSE reminder_text_stage_1 
          END,
          reminder_text_stage_2 = CASE 
            WHEN reminder_text_stage_2 IS NULL OR reminder_text_stage_2 = '' THEN 
              'Sehr geehrte Damen und Herren,

leider haben wir trotz unserer ersten Zahlungserinnerung noch keinen Zahlungseingang feststellen können. Wir möchten Sie nochmals dringend bitten, den ausstehenden Betrag umgehend zu begleichen.

Sollte die Zahlung nicht innerhalb von 5 Tagen bei uns eingehen, sehen wir uns gezwungen, weitere Schritte einzuleiten.'
            ELSE reminder_text_stage_2 
          END,
          reminder_text_stage_3 = CASE 
            WHEN reminder_text_stage_3 IS NULL OR reminder_text_stage_3 = '' THEN 
              'Sehr geehrte Damen und Herren,

trotz mehrfacher Zahlungserinnerungen ist der ausstehende Betrag noch immer nicht beglichen worden. Dies ist unsere letzte Mahnung vor rechtlichen Schritten.

Wir fordern Sie hiermit letztmalig auf, den Betrag unverzüglich, spätestens jedoch innerhalb von 3 Tagen, zu begleichen. Andernfalls werden wir ohne weitere Ankündigung rechtliche Schritte einleiten.'
            ELSE reminder_text_stage_3 
          END
        WHERE (reminder_text_stage_1 IS NULL OR reminder_text_stage_1 = '')
           OR (reminder_text_stage_2 IS NULL OR reminder_text_stage_2 = '')
           OR (reminder_text_stage_3 IS NULL OR reminder_text_stage_3 = '')
      `);
      
      logger.info(`Fixed reminder texts for ${missingReminderTextsCount} company records`);
    }
  } catch (error) {
    logger.warn('Warning: Could not fix missing reminder texts:', error.message);
  }
}

// Liest database.json (alte, unverschlüsselte Backups) oder database.json.enc (verschlüsselt).
function readBackupData(zip, passphrase) {
  const encryptedEntry = zip.getEntry('database.json.enc');
  if (encryptedEntry) {
    const headerEntry = zip.getEntry('encryption.json');
    if (!headerEntry) throw new Error('Ungültige Backup-Datei - fehlende Verschlüsselungsangaben');
    const header = JSON.parse(headerEntry.getData().toString('utf8'));
    return JSON.parse(decryptBackup(header, encryptedEntry.getData(), passphrase).toString('utf8'));
  }
  const plainEntry = zip.getEntry('database.json');
  if (!plainEntry) throw new Error('Ungültige Backup-Datei - fehlende Dateien');
  return JSON.parse(plainEntry.getData().toString('utf8'));
}

// Delete backup
router.delete('/delete/:filename', async (req, res) => {
  try {
    const { filename } = req.params;

    // Validate filename for security
    if (!ZIP_FILENAME.test(filename)) {
      return res.status(400).json({
        success: false,
        message: 'Ungültiger Dateiname'
      });
    }

    const filepath = path.join(backupDir, filename);

    try {
      await fs.unlink(filepath);
      logger.info(`Deleted backup: ${filename}`);

      res.json({
        success: true,
        message: 'Backup erfolgreich gelöscht'
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({
          success: false,
          message: 'Backup-Datei nicht gefunden'
        });
      }
      throw error;
    }

  } catch (error) {
    logger.error('Error deleting backup:', error);
    res.status(500).json({
      success: false,
      message: 'Fehler beim Löschen des Backups',
      error: error.message
    });
  }
});

// Create full ZIP backup (verschlüsselt mit Backup-Passwort)
router.post('/create-zip', async (req, res) => {
  const invalid = validatePassphrase(req.body?.passphrase);
  if (invalid) {
    return res.status(400).json({ success: false, message: invalid });
  }

  const client = await pool.connect();

  try {
    const { default: AdmZip } = await import('adm-zip');

    logger.info('Creating full ZIP backup...');

    const backup = {
      timestamp: new Date().toISOString(),
      version: '3.0',
      type: 'full',
      data: await readTables(client)
    };

    const { header, ciphertext } = encryptBackup(Buffer.from(JSON.stringify(backup)), req.body.passphrase);

    const zip = new AdmZip();
    zip.addFile('database.json.enc', ciphertext);
    zip.addFile('encryption.json', Buffer.from(JSON.stringify(header, null, 2)));

    // Metadaten bleiben lesbar (nur Zähler, keine Inhalte), damit die Liste ohne Passwort funktioniert
    const metadata = {
      name: 'OpenBills Vollbackup',
      created: backup.timestamp,
      version: backup.version,
      encrypted: true,
      tables: Object.keys(backup.data).length,
      totalRecords: Object.values(backup.data).reduce((sum, records) => sum + records.length, 0)
    };
    zip.addFile('metadata.json', Buffer.from(JSON.stringify(metadata, null, 2)));

    await fs.mkdir(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `vollbackup_${timestamp}.zip`;
    const filepath = path.join(backupDir, filename);

    const zipBuffer = zip.toBuffer();
    await fs.writeFile(filepath, zipBuffer);

    logger.info(`ZIP backup created successfully: ${filename}`);

    res.json({
      success: true,
      message: 'Vollständiges Backup erfolgreich erstellt',
      filename,
      timestamp: backup.timestamp,
      size: zipBuffer.length,
      tableCount: metadata.tables,
      totalRecords: metadata.totalRecords
    });

  } catch (error) {
    logger.error('Error creating ZIP backup:', error);
    res.status(500).json({
      success: false,
      message: 'Fehler beim Erstellen des Vollbackups',
      error: error.message
    });
  } finally {
    client.release();
  }
});

// Download ZIP backup
router.get('/download-zip/:filename', async (req, res) => {
  try {
    const { filename } = req.params;

    // Validate filename for security
    if (!ZIP_FILENAME.test(filename)) {
      return res.status(400).json({
        success: false,
        message: 'Ungültiger Dateiname'
      });
    }

    const filepath = path.join(backupDir, filename);

    try {
      await fs.access(filepath);
    } catch {
      return res.status(404).json({
        success: false,
        message: 'Backup-Datei nicht gefunden'
      });
    }

    await audit(req, { action: 'backup.downloaded', entityType: 'backup', entityId: filename });

    const backupContent = await fs.readFile(filepath);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(backupContent);

  } catch (error) {
    logger.error('Error downloading ZIP backup:', error);
    res.status(500).json({
      success: false,
      message: 'Fehler beim Download des Backups',
      error: error.message
    });
  }
});

// Upload and restore from ZIP backup
router.post('/restore-zip', async (req, res) => {
  try {
    const multer = await import('multer');
    const { default: AdmZip } = await import('adm-zip');

    const upload = multer.default({
      dest: '/tmp/',
      limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit
    });

    await new Promise((resolve, reject) => {
      upload.single('backupFile')(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Keine Backup-Datei hochgeladen'
      });
    }

    const client = await pool.connect();

    try {
      logger.info('Processing ZIP backup restore...');

      let backupData;
      try {
        backupData = readBackupData(new AdmZip(await fs.readFile(req.file.path)), req.body?.passphrase);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: error instanceof BackupPassphraseError ? error.message : 'Ungültige Backup-Datei',
          error: error.message
        });
      }

      if (!backupData || !backupData.data) {
        return res.status(400).json({
          success: false,
          message: 'Ungültige Backup-Daten'
        });
      }

      logger.info('Starting restore process...');

      await client.query('BEGIN');

      let restoredTables = 0;
      let restoredRecords = 0;

      await client.query(`TRUNCATE ${BACKUP_TABLES.map((t) => client.escapeIdentifier(t)).join(', ')} CASCADE`);

      logger.info('Restoring data...');
      const failedTables = [];
      for (const table of BACKUP_TABLES) {
        const rows = backupData.data[table];
        if (!Array.isArray(rows)) {
          logger.info(`Skipping table ${table} - no data in backup`);
          continue;
        }
        if (failedTables.length > 0) {
          // Transaktion ist nach einem Fehler abgebrochen; restliche Tabellen nur noch melden
          failedTables.push(table);
          continue;
        }
        try {
          if (rows.length > 0) {
            // Identifiers come from client-supplied JSON keys, so they MUST be
            // escaped to prevent SQL injection (values are already parameterized).
            const columns = Object.keys(rows[0]);
            const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
            const columnNames = columns.map(col => client.escapeIdentifier(col)).join(', ');
            const tableName = client.escapeIdentifier(table);

            for (const record of rows) {
              const values = columns.map(col => processValueForRestore(table, col, record[col]));
              await client.query(
                `INSERT INTO ${tableName} (${columnNames}) VALUES (${placeholders})`,
                values
              );
            }

            logger.info(`Restored ${rows.length} records to ${table}`);
            restoredRecords += rows.length;
          }

          restoredTables++;
        } catch (error) {
          logger.error(`ERROR: Could not restore table ${table}:`, error.message);
          failedTables.push(table);
        }
      }

      // Abort the whole restore (and roll back) if any table failed to import -
      // committing a partial restore would silently corrupt the database.
      if (failedTables.length > 0) {
        throw new Error(`Wiederherstellung abgebrochen: Folgende Tabellen konnten nicht wiederhergestellt werden: ${failedTables.join(', ')}`);
      }

      await resetSequences(client);
      await runCompatibilityFixes(client);

      await client.query('COMMIT');
      await audit(req, { action: 'backup.restored', entityType: 'backup', entityId: req.file.originalname, details: { format: 'zip' } });

      logger.info(`ZIP restore completed: ${restoredTables} tables, ${restoredRecords} records`);

      res.json({
        success: true,
        message: 'Vollständiges Backup erfolgreich wiederhergestellt',
        restoredTables,
        restoredRecords,
        timestamp: new Date().toISOString()
      });

    } catch (restoreError) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        logger.error('Error during rollback:', rollbackError);
      }

      logger.error('Error during ZIP restore:', restoreError);
      res.status(500).json({
        success: false,
        message: 'Fehler beim Wiederherstellen des Vollbackups',
        error: restoreError.message
      });
    } finally {
      client.release();
      try {
        await fs.unlink(req.file.path);
      } catch (cleanupError) {
        logger.warn('Could not clean up uploaded file:', cleanupError.message);
      }
    }
  } catch (error) {
    logger.error('Error in ZIP restore setup:', error);
    res.status(500).json({
      success: false,
      message: 'Fehler beim Wiederherstellen des Vollbackups',
      error: error.message
    });
  }
});

// List ZIP backups
router.get('/list-all', async (req, res) => {
  try {
    let files;
    try {
      files = await fs.readdir(backupDir);
    } catch {
      return res.json({ success: true, zipBackups: [] });
    }

    const { default: AdmZip } = await import('adm-zip');
    const zipBackups = await Promise.all(
      files.filter(file => ZIP_FILENAME.test(file)).map(async (filename) => {
        try {
          const filepath = path.join(backupDir, filename);
          const stats = await fs.stat(filepath);
          const zip = new AdmZip(await fs.readFile(filepath));
          const metadataEntry = zip.getEntry('metadata.json');
          const metadata = metadataEntry ? JSON.parse(metadataEntry.getData().toString('utf8')) : {};

          return {
            filename,
            type: 'zip',
            timestamp: metadata.created || stats.birthtime.toISOString(),
            size: stats.size,
            tableCount: metadata.tables || 0,
            totalRecords: metadata.totalRecords || 0,
            encrypted: Boolean(zip.getEntry('database.json.enc')),
            created: stats.birthtime.toISOString()
          };
        } catch (error) {
          logger.warn(`Could not parse ZIP backup file ${filename}:`, error.message);
          return null;
        }
      })
    );

    const validZipBackups = zipBackups.filter(backup => backup !== null);
    validZipBackups.sort((a, b) => new Date(b.created) - new Date(a.created));

    res.json({
      success: true,
      zipBackups: validZipBackups
    });

  } catch (error) {
    logger.error('Error listing all backups:', error);
    res.status(500).json({
      success: false,
      message: 'Fehler beim Auflisten der Backups',
      error: error.message
    });
  }
});

export default router;
