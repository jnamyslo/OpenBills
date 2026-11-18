// Einzige Quelle für den Umfang von Backup/Restore.
// Jede Tabelle der DB muss in genau einer der drei Listen stehen (geprüft in tests/backupRestore.test.js).

// In Restore-Reihenfolge: Eltern vor Kindern (Foreign Keys).
export const BACKUP_TABLES = [
  'company',
  'customers',
  'yearly_invoice_start_numbers',
  'hourly_rates',                    // -> company
  'material_templates',              // -> company
  'smtp_settings',
  'customer_hourly_rates',           // -> customers, hourly_rates
  'customer_specific_hourly_rates',  // -> customers
  'customer_specific_materials',     // -> customers
  'invoices',                        // -> customers
  'invoice_items',                   // -> invoices
  'invoice_attachments',             // -> invoices
  'quotes',                          // -> customers, invoices
  'quote_items',                     // -> quotes
  'quote_attachments',               // -> quotes
  'quote_responses',                 // -> quotes
  'job_entries',                     // -> customers, quotes, invoices
  'job_attachments',                 // -> job_entries
  'job_time_entries',                // -> job_entries
  'customer_emails',                 // -> customers
  'email_history',                   // -> invoices, quotes, customers
];

// Nur auf Wunsch im Backup (Default aus), siehe docs/superpowers/specs/2026-11-17-document-archive-storno.md.
export const OPTIONAL_TABLES = ['document_archive'];

// Bewusst nicht im Backup: Instanz-/Auth-Zustand, der beim Restore erhalten bleiben muss.
export const EXCLUDED_TABLES = [
  'migrations',          // Schemastand der Instanz
  'usage_counters',      // Plan-Kontingent der Instanz
  'users',
  'user_recovery_codes',
  'sessions',
  'auth_tokens',
  'rate_limits',
  'audit_log',
  'demo_marker',         // Kennzeichnung als Demo-DB (darf nie per Restore übertragen werden)
];
