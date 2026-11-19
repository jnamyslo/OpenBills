import React, { useState, useEffect, useRef } from 'react';
import { demoMailNote } from '../utils/demo';
import logger from '../utils/logger';
import { withInvoiceContent } from '../utils/attachmentContent';
import { Plus, Edit, Trash2, Search, Download, FileText, Send, Check, Mail, Eye, Ban, Info } from 'lucide-react';
import { useCustomers } from '../context/CustomerContext';
import { useInvoices } from '../context/InvoiceContext';
import { useJobs } from '../context/JobContext';
import { useQuotes } from '../context/QuoteContext';
import { useCompany } from '../context/CompanyContext';
import { featureUpgradeReason, usePlan } from '../context/PlanContext';
import { Customer, Invoice } from '../types';
import { InvoiceEditor } from './InvoiceEditor';
import { ConfirmationModal } from './ConfirmationModal';
import { EmailSendModal } from './EmailSendModal';
import { DownloadModal } from './DownloadModal';
import { CancelInvoiceModal, CancelMode } from './CancelInvoiceModal';
import { InvoiceDetailsModal } from './InvoiceDetailsModal';
import { isCancellable, isUnsentCancellation } from '../utils/invoiceStatus';
import { draftCopyOfInvoice } from '../utils/invoiceCopy';
import { DocumentPreview, PreviewDocument } from './DocumentPreview';
import { createInvoiceAttachmentPreviewDocuments } from '../utils/previewDocuments';
import { generateInvoicePDF, downloadBlob } from '../utils/pdfGenerator';
import { apiService, isPlanError } from '../services/api';
import { formatCurrency } from '../utils/formatters';
import { blobToBase64, base64ToBlob } from '../utils/blobUtils';
import { releaseForOutput } from '../utils/releaseForOutput';
import { archiveOutput, notArchivedNote } from '../utils/archiveOutput';
import { clearCreateRoute } from '../utils/quickActions';

interface InvoiceManagementProps {
  initialFilter?: string;
  initialSearchTerm?: string;
  onNavigate?: (page: string) => void;
  /** Über Dashboard-Schnellaktion (#invoices/new): Editor für neue Rechnung direkt öffnen. */
  autoCreate?: boolean;
  /** Über #invoices/edit/<id> (z. B. nach Umwandlung eines Auftrags): Rechnung direkt öffnen. */
  openInvoiceId?: string;
}

export function InvoiceManagement({ initialFilter, initialSearchTerm, onNavigate, autoCreate, openInvoiceId }: InvoiceManagementProps = {}) {
  const { customers } = useCustomers();
  const { invoices, addInvoice, deleteInvoice, updateInvoice, refreshInvoices } = useInvoices();
  const { refreshJobEntries } = useJobs();
  const { refreshQuotes } = useQuotes();
  const { company } = useCompany();
  const { hasFeature, showUpgrade } = usePlan();
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [searchTerm, setSearchTerm] = useState(initialSearchTerm || '');
  const [filterStatus, setFilterStatus] = useState(initialFilter || 'not-paid');
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const [isSendingEmail, setIsSendingEmail] = useState<string | null>(null);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [isBulkOperation, setIsBulkOperation] = useState(false);
  // Gesperrte (freigegebene) Rechnungen öffnen die Detailansicht statt des Editors
  const [detailsInvoice, setDetailsInvoice] = useState<Invoice | null>(null);
  const [cancelRequest, setCancelRequest] = useState<{ invoice: Invoice; mode: CancelMode } | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  // Freigegebene Rechnungen ohne Archivfassung; Stornorechnungen darunter gelten als „noch nicht versendet“
  const [unarchivedIds, setUnarchivedIds] = useState<ReadonlySet<string>>(new Set());
  
  
  // Get locale from company settings, default to 'de-DE'
  const locale = company?.locale || 'de-DE';
  
  // Email dialog state
  const [emailModal, setEmailModal] = useState<{
    isOpen: boolean;
    invoice: Invoice | null;
    customer: { email: string; additionalEmails?: { id: string; email: string; label?: string; isActive: boolean }[] } | null;
    isBulkMode?: boolean;
    bulkInvoices?: Invoice[];
  }>({
    isOpen: false,
    invoice: null,
    customer: null,
    isBulkMode: false,
    bulkInvoices: []
  });
  
  // Download modal state
  const [downloadModal, setDownloadModal] = useState<{
    isOpen: boolean;
    invoice: Invoice | null;
    isBulkMode?: boolean;
    bulkInvoices?: Invoice[];
  }>({
    isOpen: false,
    invoice: null,
    isBulkMode: false,
    bulkInvoices: []
  });
  
  // Document Preview state
  const [documentPreview, setDocumentPreview] = useState<{
    isOpen: boolean;
    documents: PreviewDocument[];
    initialIndex: number;
  }>({
    isOpen: false,
    documents: [],
    initialIndex: 0
  });
  
  // Modal states
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDestructive?: boolean;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // Neu laden, wenn sich Rechnungen ändern oder Versand-/Download-Dialog schließt (Ausgabe archiviert)
  useEffect(() => {
    apiService.getArchiveMissing()
      .then(missing => setUnarchivedIds(new Set(missing.invoices)))
      .catch(error => logger.warn('Fehlende Archivfassungen konnten nicht geladen werden', { error: String(error) }));
  }, [invoices, emailModal.isOpen, downloadModal.isOpen]);

  // Update filter and search when initialFilter/initialSearchTerm props change
  useEffect(() => {
    if (initialFilter) {
      setFilterStatus(initialFilter);
    }
    if (initialSearchTerm) {
      setSearchTerm(initialSearchTerm);
    }
  }, [initialFilter, initialSearchTerm]);

  // Check for overdue invoices automatically on every load
  useEffect(() => {
    const checkOverdueInvoices = async () => {
      if (invoices.length === 0) return;
      
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Set to start of day for accurate comparison
      
      const overdueUpdates = invoices
        .filter(invoice => {
          // Only check sent invoices that are not already overdue or paid
          if (invoice.status !== 'sent') return false;
          
          const dueDate = new Date(invoice.dueDate);
          dueDate.setHours(0, 0, 0, 0);
          
          return dueDate < today;
        })
        .map(invoice => invoice.id);
      
      // Update overdue invoices
      for (const invoiceId of overdueUpdates) {
        try {
          await updateInvoice(invoiceId, { status: 'overdue' });
        } catch (error) {
          logger.error('Error updating invoice to overdue:', error);
        }
      }
      
      if (overdueUpdates.length > 0) {
        logger.debug(`${overdueUpdates.length} Rechnungen wurden automatisch als überfällig markiert.`);
      }
    };

    // Run overdue check whenever invoices are loaded or updated
    if (invoices.length > 0) {
      checkOverdueInvoices();
    }
  }, [invoices, updateInvoice]);

  const filteredInvoices = invoices.filter(invoice => {
    const invoiceNumber = invoice.invoiceNumber || '';
    const customerName = invoice.customerName || '';
    const searchTermLower = searchTerm.toLowerCase();
    
    const matchesSearch = invoiceNumber.toLowerCase().includes(searchTermLower) ||
                         customerName.toLowerCase().includes(searchTermLower);
    
    let matchesStatus = false;
    if (filterStatus === 'all') {
      matchesStatus = true;
    } else if (filterStatus === 'not-paid') {
      matchesStatus = (invoice.status !== 'paid' && invoice.status !== 'cancelled') || isUnsentCancellation(invoice, unarchivedIds);
    } else {
      matchesStatus = invoice.status === filterStatus;
    }
    
    return matchesSearch && matchesStatus;
  });

  const handleOpenEditor = (invoice?: Invoice) => {
    // Freigegebene Rechnungen sind gesperrt (Backend: 409 INVOICE_LOCKED) → Detailansicht
    if (invoice && invoice.status !== 'draft') {
      setDetailsInvoice(invoice);
      return;
    }
    setEditingInvoice(invoice || null);
    setIsEditorOpen(true);
  };

  // Dashboard-Schnellaktion: direkt neu anlegen
  useEffect(() => {
    if (!autoCreate) return;
    handleOpenEditor();
    clearCreateRoute('invoices');
  }, [autoCreate]);

  // Direkt eine bestimmte Rechnung öffnen, sobald sie geladen ist (nur einmal je ID,
  // die App-Route bleibt nach replaceState stehen)
  const openedInvoiceIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!openInvoiceId || openedInvoiceIdRef.current === openInvoiceId) return;
    const invoice = invoices.find(i => i.id === openInvoiceId);
    if (!invoice) return;
    openedInvoiceIdRef.current = openInvoiceId;
    handleOpenEditor(invoice);
    clearCreateRoute('invoices');
  }, [openInvoiceId, invoices]);

  const handleCloseEditor = () => {
    setIsEditorOpen(false);
    setEditingInvoice(null);
  };

  // Nur Entwürfe; freigegebene Rechnungen werden storniert
  const handleDelete = async (invoice: Invoice) => {
    setConfirmModal({
      isOpen: true,
      title: 'Rechnung löschen',
      message: `Möchten Sie die Rechnung ${invoice.invoiceNumber} wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`,
      onConfirm: async () => {
        try {
          await deleteInvoice(invoice.id);
        } catch (error) {
          logger.error('Error deleting invoice', { error });
          alert('Fehler beim Löschen der Rechnung: ' + (error as Error).message);
        }
      },
      isDestructive: true
    });
  };

  const handleCancelConfirm = async (reason: string, releaseSources: boolean) => {
    if (!cancelRequest) return;
    const { invoice, mode } = cancelRequest;
    setIsCancelling(true);
    try {
      if (mode === 'cancel') {
        const { cancellation } = await apiService.cancelInvoice(invoice.id, { reason, releaseSources });
        await Promise.all([refreshInvoices(), refreshJobEntries(), refreshQuotes()]);
        setCancelRequest(null);
        setDetailsInvoice(null);
        alert(`Rechnung ${invoice.invoiceNumber} storniert. Stornorechnung ${cancellation.invoiceNumber} wurde erstellt.`);
        return;
      }

      // Stornieren und neu erstellen: erst den Entwurf anlegen, dann stornieren und die
      // Quellen (Aufträge, Angebot) in derselben Transaktion auf den Entwurf umhängen.
      const draft = await addInvoice(draftCopyOfInvoice(await withInvoiceContent(invoice)));
      try {
        await apiService.cancelInvoice(invoice.id, { reason, releaseSources: false, replacementInvoiceId: draft.id });
      } catch (error) {
        await deleteInvoice(draft.id).catch(() => undefined);
        throw error;
      }
      await Promise.all([refreshInvoices(), refreshJobEntries(), refreshQuotes()]);
      setCancelRequest(null);
      setDetailsInvoice(null);
      setEditingInvoice(draft);
      setIsEditorOpen(true);
    } catch (error) {
      logger.error('Fehler beim Stornieren', { error: String(error), invoiceId: invoice.id });
      if (!isPlanError(error)) alert('Fehler beim Stornieren: ' + (error as Error).message);
    } finally {
      setIsCancelling(false);
    }
  };

  const handleStatusChange = async (id: string, newStatus: Invoice['status']) => {
    try {
      await updateInvoice(id, { status: newStatus });
    } catch (error) {
      logger.error('Error updating invoice status', { error });
      alert('Fehler beim Ändern des Status. Bitte versuchen Sie es erneut.');
    }
  };

  const handleExport = (invoice: Invoice) => {
    // Open download modal
    setDownloadModal({
      isOpen: true,
      invoice
    });
  };

  const handlePreview = async (invoice: Invoice) => {
    // Create preview documents for the invoice (Anhang-Inhalte bei Bedarf nachladen)
    let documents: PreviewDocument[];
    try {
      documents = createInvoiceAttachmentPreviewDocuments(await withInvoiceContent(invoice));
    } catch (error) {
      logger.error('Fehler beim Laden der Anhänge:', { error: String(error) });
      alert('Anhänge konnten nicht geladen werden.');
      return;
    }
    
    setDocumentPreview({
      isOpen: true,
      documents,
      initialIndex: 0
    });
  };

  const handleClosePreview = () => {
    setDocumentPreview({
      isOpen: false,
      documents: [],
      initialIndex: 0
    });
  };

  const handleDownloadConfirm = async (formats: ('zugferd' | 'xrechnung')[], markAsSent: boolean, selectedAttachmentIds: string[] = []) => {
    if (!downloadModal.invoice) return;

    // "Als versendet markieren": Entwurf vor dem Download freigeben (zählt gegen das
    // Plan-Kontingent) → Dokument ohne Wasserzeichen. Ohne Freigabe trägt ein Entwurf
    // das Wasserzeichen; XRechnung ist dann nicht möglich.
    const downloadInvoiceFiles = async (invoice: Invoice, customer: Customer, delayMs: number) => {
      // Erst alle Dateien erzeugen und archivieren, dann herunterladen: scheitert das Archiv,
      // wird nichts ausgegeben (und releaseForOutput setzt die Freigabe zurück).
      const download = async (doc: Invoice) => {
        const files = [];
        for (const format of formats) {
          const blob = await generateInvoicePDF(doc, { format, company, customer });
          const filename = format === 'xrechnung'
            ? `${doc.invoiceNumber}_xrechnung.xml`
            : `${doc.invoiceNumber}.pdf`;
          await archiveOutput(doc, 'invoice', format, blob, filename);
          files.push({ blob, filename });
        }
        for (let i = 0; i < files.length; i++) {
          if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
          downloadBlob(files[i].blob, files[i].filename);
        }
      };
      if (markAsSent) {
        await releaseForOutput(invoice, status => updateInvoice(invoice.id, { status }), download);
      } else {
        await download(invoice);
      }
    };
    
    // Handle bulk mode
    if (downloadModal.isBulkMode && downloadModal.bulkInvoices) {
      setIsBulkOperation(true);
      
      try {
        let successCount = 0;
        let errorCount = 0;
        
        for (const invoice of downloadModal.bulkInvoices) {
          try {
            const customer = customers.find(c => c.id === invoice.customerId);
            if (!customer) {
              logger.warn(`No customer found for invoice ${invoice.invoiceNumber}`);
              errorCount++;
              continue;
            }
            
            await downloadInvoiceFiles(invoice, customer, 1500);

            // Download invoice attachments if they exist and are selected (matches single-download behavior)
            const bulkSelectedAttachments = selectedAttachmentIds.length > 0
              ? ((await withInvoiceContent(invoice)).attachments || []).filter(att => selectedAttachmentIds.includes(att.id))
              : [];
            if (bulkSelectedAttachments.length > 0) {
              for (let i = 0; i < bulkSelectedAttachments.length; i++) {
                const attachment = bulkSelectedAttachments[i];

                // Add delay between attachment downloads
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Convert base64 to blob and download
                try {
                  const base64Data = attachment.content.split(',')[1] || attachment.content;
                  const blob = base64ToBlob(base64Data, attachment.contentType);
                  
                  // Add invoice number prefix to attachment filename
                  const attachmentFilename = `${invoice.invoiceNumber}_${attachment.name}`;
                  downloadBlob(blob, attachmentFilename);
                } catch (error) {
                  logger.error(`Error downloading attachment ${attachment.name} for invoice ${invoice.invoiceNumber}:`, error);
                }
              }
            }
            
            successCount++;
          } catch (error) {
            logger.error(`Error downloading invoice ${invoice.invoiceNumber}:`, error);
            errorCount++;
          }
        }
        
        alert(`${successCount} Rechnung(en) erfolgreich heruntergeladen!${errorCount > 0 ? ` - ${errorCount} Fehler` : ''}`);
        
        // Clear selection and close modal
        setSelectedInvoiceIds([]);
        setDownloadModal({ isOpen: false, invoice: null, isBulkMode: false, bulkInvoices: [] });
        
      } catch (error) {
        logger.error('Bulk download error:', error);
        alert('Fehler beim Bulk-Download: ' + (error as Error).message);
      } finally {
        setIsBulkOperation(false);
      }
      return;
    }
    
    // Single invoice mode (existing code)
    const invoice = downloadModal.invoice;
    setIsExporting(invoice.id);
    
    try {
      const customer = customers.find(c => c.id === invoice.customerId);
      if (!customer) {
        alert('Kundendaten nicht gefunden.');
        return;
      }

      await downloadInvoiceFiles(invoice, customer, 1000);

      // Download invoice attachments if they exist and are selected
      if (invoice.attachments && invoice.attachments.length > 0 && selectedAttachmentIds.length > 0) {
        const selectedAttachments = ((await withInvoiceContent(invoice)).attachments || []).filter(att => selectedAttachmentIds.includes(att.id));
        
        for (let i = 0; i < selectedAttachments.length; i++) {
          const attachment = selectedAttachments[i];
          
          // Add delay between attachment downloads
          if (i > 0 || formats.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
          // Convert base64 to blob and download
          try {
            const base64Data = attachment.content.split(',')[1] || attachment.content;
            const blob = base64ToBlob(base64Data, attachment.contentType);
            
            // Add invoice number prefix to attachment filename
            const attachmentFilename = `${invoice.invoiceNumber}_${attachment.name}`;
            downloadBlob(blob, attachmentFilename);
          } catch (error) {
            logger.error(`Error downloading attachment ${attachment.name} for invoice ${invoice.invoiceNumber}:`, error);
          }
        }
      }
      
    } catch (error) {
      logger.error('Fehler beim Generieren der Datei:', error);
      // Tarif-Fehler zeigt der Upgrade-Dialog
      if (!isPlanError(error)) alert('Fehler beim Erstellen der Datei: ' + (error as Error).message);
    } finally {
      setIsExporting(null);
      setDownloadModal({ isOpen: false, invoice: null, isBulkMode: false, bulkInvoices: [] });
    }
  };

  const handleSendEmail = async (invoice: Invoice) => {
    if (!hasFeature('email')) {
      showUpgrade(featureUpgradeReason('email'));
      return;
    }
    const customer = customers.find(c => c.id === invoice.customerId);
    if (!customer) {
      alert('Kundendaten nicht gefunden.');
      return;
    }

    if (!customer.email) {
      alert('Kunde hat keine E-Mail-Adresse hinterlegt.');
      return;
    }

    // Open email dialog with customer data
    setEmailModal({
      isOpen: true,
      invoice,
      customer: {
        email: customer.email,
        additionalEmails: customer.additionalEmails
      }
    });
  };

  const handleEmailSend = async (formats: ('zugferd' | 'xrechnung')[], customText?: string, attachments?: { id: string; file: File; name: string; size: number }[], selectedInvoiceAttachmentIds?: string[], selectedEmails?: string[], manualEmails?: string[]) => {
    if (!emailModal.invoice) return;
    
    // Handle bulk mode
    if (emailModal.isBulkMode && emailModal.bulkInvoices) {
      setIsBulkOperation(true);
      
      try {
        let successCount = 0;
        let errorCount = 0;
        let notArchived = 0;
        
        for (const invoice of emailModal.bulkInvoices) {
          try {
            const customer = customers.find(c => c.id === invoice.customerId);
            if (!customer?.email) {
              logger.warn(`No email for customer of invoice ${invoice.invoiceNumber}`);
              errorCount++;
              continue;
            }

            // Process additional attachments
            let processedAttachments: { name: string; content: string; contentType: string }[] = [];
            if (attachments && attachments.length > 0) {
              try {
                const { processAttachments } = await import('../utils/fileUtils');
                processedAttachments = await processAttachments(attachments);
              } catch (error) {
                logger.error('Error processing attachments:', error);
                errorCount++;
                continue;
              }
            }

            // Auswahl der Rechnungs-Anhänge aus dem Modal berücksichtigen: nur
            // Anhänge anfügen, die zu dieser Rechnung gehören UND ausgewählt wurden
            // (der Einzelversand filtert bereits so).
            if (selectedInvoiceAttachmentIds && selectedInvoiceAttachmentIds.length > 0 && invoice.attachments) {
              const selectedOwnAttachments = ((await withInvoiceContent(invoice)).attachments || []).filter(att =>
                selectedInvoiceAttachmentIds.includes(att.id)
              );
              for (const storedAttachment of selectedOwnAttachments) {
                processedAttachments.push({
                  name: storedAttachment.name,
                  content: storedAttachment.content,
                  contentType: storedAttachment.contentType
                });
              }
            }

            // Empfänger: eigene Adressen des Kunden plus im Modal ausgewählte /
            // manuell erfasste Adressen. MUSS ein Array sein — die API und
            // /api/email/send-invoice-multi lehnen einen String mit HTTP 400 ab.
            const customerEmails = [
              customer.email,
              ...(customer.additionalEmails?.filter(e => e.isActive).map(e => e.email) || [])
            ];
            const extraEmails = [...(selectedEmails || []), ...(manualEmails || [])];
            const recipients = Array.from(
              new Set([...customerEmails, ...extraEmails].filter(Boolean))
            ) as string[];

            // Entwürfe werden vor dem Versand freigegeben (zählt gegen das Plan-Kontingent),
            // damit der Kunde kein Dokument mit Wasserzeichen erhält.
            const sent = await releaseForOutput(invoice, status => updateInvoice(invoice.id, { status }), async released => {
              const invoiceFormats = [];
              for (const format of formats) {
                const pdfBlob = await generateInvoicePDF(released, { format, company, customer });
                invoiceFormats.push({ format, content: await blobToBase64(pdfBlob) });
              }

              const result = await apiService.sendInvoiceEmailMultiFormat(
                recipients,
                invoiceFormats,
                released,
                customText,
                processedAttachments
              );
              if (!result.success) {
                throw new Error(`Email send failed: ${result.message}`);
              }
              return result;
            });
            if (sent.archived === false) notArchived++;
            
            successCount++;
          } catch (error) {
            logger.error(`Error sending invoice ${invoice.invoiceNumber}:`, error);
            errorCount++;
          }
        }
        
        const formatLabels = formats.map(f => {
          switch(f) {
            case 'zugferd': return 'PDF';
            case 'xrechnung': return 'XRechnung';
            default: return f;
          }
        });
        
        const attachmentInfo = attachments && attachments.length > 0 
          ? ` mit ${attachments.length} zusätzlichen Anhang${attachments.length > 1 ? 'en' : ''}`
          : '';
        
        alert(`${successCount} Rechnung(en) erfolgreich versendet! (${formatLabels.join(', ')})${attachmentInfo}${errorCount > 0 ? ` - ${errorCount} Fehler` : ''}${demoMailNote()}${notArchivedNote(notArchived)}`);
        
        // Clear selection and close modal
        setSelectedInvoiceIds([]);
        setEmailModal({ isOpen: false, invoice: null, customer: null, isBulkMode: false, bulkInvoices: [] });
        
      } catch (error) {
        logger.error('Bulk email error:', error);
        alert('Fehler beim Bulk-E-Mail-Versand: ' + (error as Error).message);
      } finally {
        setIsBulkOperation(false);
      }
      return;
    }
    
    // Single invoice mode (existing code)
    setIsSendingEmail(emailModal.invoice.id);
    
    try {
      // Generate PDFs for each format and send emails
      const customer = customers.find(c => c.id === emailModal.invoice!.customerId);
      if (!customer) {
        alert('Kundendaten nicht gefunden.');
        return;
      }

      // Process additional attachments
      let processedAttachments: { name: string; content: string; contentType: string }[] = [];
      if (attachments && attachments.length > 0) {
        try {
          const { processAttachments } = await import('../utils/fileUtils');
          processedAttachments = await processAttachments(attachments);
        } catch (error) {
          logger.error('Fehler beim Verarbeiten der Anhänge:', error);
          alert('Fehler beim Verarbeiten der Anhänge');
          return;
        }
      }

      // Add selected invoice attachments to the processed attachments
      if (selectedInvoiceAttachmentIds && selectedInvoiceAttachmentIds.length > 0 && emailModal.invoice.attachments) {
        const selectedInvoiceAttachments = ((await withInvoiceContent(emailModal.invoice)).attachments || []).filter(att => 
          selectedInvoiceAttachmentIds.includes(att.id)
        );
        
        for (const storedAttachment of selectedInvoiceAttachments) {
          processedAttachments.push({
            name: storedAttachment.name,
            content: storedAttachment.content,
            contentType: storedAttachment.contentType
          });
        }
      }

      // Combine selected emails and manual emails
      const allEmails = [...(selectedEmails || []), ...(manualEmails?.filter(email => email.trim()) || [])];

      if (allEmails.length === 0) {
        alert('Bitte wählen Sie mindestens eine E-Mail-Adresse aus.');
        return;
      }

      // Entwürfe werden vor dem Versand freigegeben (zählt gegen das Plan-Kontingent),
      // damit der Kunde kein Dokument mit Wasserzeichen erhält.
      const invoiceToSend = emailModal.invoice;
      const sent = await releaseForOutput(invoiceToSend, status => updateInvoice(invoiceToSend.id, { status }), async released => {
        const invoiceFormats = [];
        for (const format of formats) {
          const pdfBlob = await generateInvoicePDF(released, { format, company, customer });
          // Convert blob to base64 - use safe method for large files
          invoiceFormats.push({ format, content: await blobToBase64(pdfBlob) });
        }

        const result = await apiService.sendInvoiceEmailMultiFormat(
          allEmails,
          invoiceFormats,
          released,
          customText,
          processedAttachments
        );
        if (!result.success) {
          throw new Error(`Fehler beim E-Mail-Versand: ${result.message}`);
        }
        return result;
      });
      
      const formatLabels = formats.map(f => {
        switch(f) {
          case 'zugferd': return 'PDF';
          case 'xrechnung': return 'XRechnung';
          default: return f;
        }
      });
      
      const attachmentInfo = attachments && attachments.length > 0 
        ? ` mit ${attachments.length} zusätzlichen Anhang${attachments.length > 1 ? 'en' : ''}`
        : '';
      
      alert(`Rechnung erfolgreich per E-Mail versendet! (${formatLabels.join(', ')})${attachmentInfo}${demoMailNote()}${notArchivedNote(sent.archived === false ? 1 : 0)}`);
      
      // Close email dialog
      setEmailModal({ isOpen: false, invoice: null, customer: null, isBulkMode: false, bulkInvoices: [] });
    } catch (error) {
      logger.error('Fehler beim E-Mail-Versand:', error);
      // Tarif-Fehler zeigt der Upgrade-Dialog
      if (!isPlanError(error)) alert('Fehler beim E-Mail-Versand: ' + (error as Error).message);
    } finally {
      setIsSendingEmail(null);
    }
  };

  const handleEmailModalClose = () => {
    setEmailModal({ isOpen: false, invoice: null, customer: null, isBulkMode: false, bulkInvoices: [] });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid': return 'bg-green-100 text-green-800';
      case 'sent': return 'bg-primary-custom/10 text-primary-custom';
      case 'draft': return 'bg-gray-100 text-gray-800';
      case 'overdue': return 'bg-red-100 text-red-800';
      case 'reminded_1x': return 'bg-orange-100 text-orange-800';
      case 'reminded_2x': return 'bg-orange-200 text-orange-900';
      case 'reminded_3x': return 'bg-red-200 text-red-900';
      case 'cancelled': return 'bg-gray-100 text-gray-500 line-through';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'paid': return 'Bezahlt';
      case 'sent': return 'Versendet';
      case 'draft': return 'Entwurf';
      case 'overdue': return 'Überfällig';
      case 'reminded_1x': return '1x gemahnt';
      case 'reminded_2x': return '2x gemahnt';
      case 'reminded_3x': return '3x gemahnt';
      case 'cancelled': return 'Storniert';
      default: return status;
    }
  };

  const getInvoiceStatusLabel = (invoice: Invoice) =>
    invoice.invoiceType === 'cancellation' ? 'Stornorechnung' : getStatusLabel(invoice.status);

  const cancellationNote = (invoice: Invoice) =>
    invoice.cancelsInvoice ? `Storno zu ${invoice.cancelsInvoice.invoiceNumber}`
      : invoice.cancelledByInvoice ? `Storniert durch ${invoice.cancelledByInvoice.invoiceNumber}`
      : null;

  // Bulk operations functions
  const handleInvoiceSelection = (invoiceId: string, checked: boolean) => {
    if (checked) {
      setSelectedInvoiceIds(prev => [...prev, invoiceId]);
    } else {
      setSelectedInvoiceIds(prev => prev.filter(id => id !== invoiceId));
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedInvoiceIds(filteredInvoices.map(invoice => invoice.id));
    } else {
      setSelectedInvoiceIds([]);
    }
  };

  const handleBulkStatusChange = async (newStatus: Invoice['status']) => {
    if (selectedInvoiceIds.length === 0) return;
    
    setIsBulkOperation(true);
    try {
      // Fehler pro Rechnung abfangen, damit ein Fehlschlag nicht den Rest
      // des Stapels abbricht.
      let successCount = 0;
      let errorCount = 0;
      for (const invoiceId of selectedInvoiceIds) {
        try {
          await updateInvoice(invoiceId, { status: newStatus });
          successCount++;
        } catch (error) {
          logger.error('Error updating invoice status', { error, invoiceId });
          errorCount++;
        }
      }
      setSelectedInvoiceIds([]);
      alert(errorCount > 0
        ? `${successCount} Rechnung(en) aktualisiert, ${errorCount} fehlgeschlagen.`
        : `${successCount} Rechnung(en) erfolgreich aktualisiert.`);
    } catch (error) {
      logger.error('Error updating invoice statuses', { error });
      alert('Fehler beim Aktualisieren der Rechnungen.');
    } finally {
      setIsBulkOperation(false);
    }
  };

  const handleBulkEmail = async () => {
    if (!hasFeature('email')) {
      showUpgrade(featureUpgradeReason('email'));
      return;
    }
    if (selectedInvoiceIds.length === 0) return;
    
    const selectedInvoices = invoices.filter(inv => selectedInvoiceIds.includes(inv.id));
    
    // Open email modal in bulk mode for all selected invoices
    setEmailModal({
      isOpen: true,
      invoice: selectedInvoices[0], // Use first invoice as template
      customer: null, // Will be handled per invoice
      isBulkMode: true,
      bulkInvoices: selectedInvoices
    });
  };

  const handleBulkDownload = async () => {
    if (selectedInvoiceIds.length === 0) return;
    
    const selectedInvoices = invoices.filter(inv => selectedInvoiceIds.includes(inv.id));
    
    // Open download modal in bulk mode
    setDownloadModal({
      isOpen: true,
      invoice: selectedInvoices[0], // Use first invoice as template
      isBulkMode: true,
      bulkInvoices: selectedInvoices
    });
  };

  if (isEditorOpen) {
    return (
      <InvoiceEditor
        invoice={editingInvoice}
        onClose={handleCloseEditor}
        onNavigateToCustomers={() => onNavigate && onNavigate('customers')}
        onNavigateToSettings={() => onNavigate && onNavigate('settings')}
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-2xl lg:text-3xl font-bold text-gray-900">Rechnungen</h2>
          <p className="text-gray-600 mt-1">Verwalten Sie Ihre Rechnungen</p>
        </div>
        <button
          onClick={() => handleOpenEditor()}
          className="btn-primary text-white px-4 py-2 rounded-xl flex items-center justify-center space-x-2 hover:brightness-90 transition-all duration-300 hover:scale-105"
        >
          <Plus className="h-5 w-5" />
          <span className="hidden sm:inline">Neue Rechnung</span>
          <span className="sm:hidden">Neu</span>
        </button>
      </div>

      {/* Bulk Operations Bar */}
      {selectedInvoiceIds.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center">
              <span className="text-sm text-blue-800 font-medium">
                {selectedInvoiceIds.length} Rechnung(en) ausgewählt
              </span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              {/* Bulk Status Change */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-blue-800">Status ändern:</span>
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      handleBulkStatusChange(e.target.value as Invoice['status']);
                      e.target.value = '';
                    }
                  }}
                  disabled={isBulkOperation}
                  className="text-xs px-2 py-1 border border-blue-300 rounded focus:ring-2 focus:ring-blue-500"
                  defaultValue=""
                >
                  <option value="">Wählen...</option>
                  <option value="draft">Entwurf</option>
                  <option value="sent">Versendet</option>
                  <option value="paid">Bezahlt</option>
                  <option value="overdue">Überfällig</option>
                </select>
              </div>
              
              {/* Bulk Email */}
              <button
                onClick={handleBulkEmail}
                disabled={isBulkOperation}
                className="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 transition-colors flex items-center text-sm disabled:bg-gray-400"
              >
                <Mail className="h-4 w-4 mr-1" />
                E-Mail versenden
              </button>
              
              {/* Bulk Download */}
              <button
                onClick={handleBulkDownload}
                disabled={isBulkOperation}
                className="bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 transition-colors flex items-center text-sm disabled:bg-gray-400"
              >
                <Download className="h-4 w-4 mr-1" />
                Herunterladen
              </button>
              
              {/* Clear Selection */}
              <button
                onClick={() => setSelectedInvoiceIds([])}
                className="bg-gray-200 text-gray-700 px-3 py-1 rounded hover:bg-gray-300 transition-colors text-sm"
              >
                Auswahl aufheben
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="h-5 w-5 absolute left-3 top-3 text-gray-400" />
            <input
              type="text"
              placeholder="Rechnungen suchen..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Alle Status</option>
            <option value="not-paid">Alle außer bezahlt/storniert</option>
            <option value="draft">Entwurf</option>
            <option value="sent">Versendet</option>
            <option value="paid">Bezahlt</option>
            <option value="overdue">Überfällig</option>
            <option value="cancelled">Storniert</option>
          </select>
        </div>
      </div>

      {/* Invoice List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        {/* Desktop/Tablet Table View */}
        <div className="hidden md:block overflow-x-auto scrollbar-hide">
          <div className="min-w-full overflow-hidden">
            <table className="w-full min-w-[900px]">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-3 text-left w-16">
                  <input
                    type="checkbox"
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    checked={
                      filteredInvoices.length > 0 &&
                      filteredInvoices.every(invoice => selectedInvoiceIds.includes(invoice.id))
                    }
                    className="custom-checkbox"
                    title="Alle auswählen"
                  />
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                  Rechnungsnummer
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Kunde
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                  Datum
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                  Fälligkeitsdatum
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                  Betrag
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                  Status
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48">
                  Aktionen
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredInvoices.map((invoice) => (
                <tr key={invoice.id} onClick={(e) => { if ((e.target as HTMLElement).closest('button, a, input, label, select, textarea')) return; handleOpenEditor(invoice); }} className="cursor-pointer hover:bg-gray-50">
                  <td className="px-3 py-4 w-16">
                    <input
                      type="checkbox"
                      checked={selectedInvoiceIds.includes(invoice.id)}
                      onChange={(e) => handleInvoiceSelection(invoice.id, e.target.checked)}
                      className="custom-checkbox"
                      title="Rechnung auswählen"
                    />
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {invoice.invoiceNumber}
                    {cancellationNote(invoice) && (
                      <div className="text-xs font-normal text-gray-500">{cancellationNote(invoice)}</div>
                    )}
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900">
                    {invoice.customerName}
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900">
                    {new Date(invoice.issueDate).toLocaleDateString('de-DE')}
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900">
                    {new Date(invoice.dueDate).toLocaleDateString('de-DE')}
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatCurrency(invoice.total, locale)}
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap">
                    <div className="flex flex-col space-y-1">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(invoice.status)}`}>
                        {getInvoiceStatusLabel(invoice)}
                      </span>
                      {(invoice.status === 'draft' || isUnsentCancellation(invoice, unarchivedIds)) && (
                        <button
                          className="bg-primary-light-custom hover:bg-primary-medium-custom text-primary-custom hover:text-primary-custom px-2 py-1 rounded-md transition-colors duration-200 shadow-sm flex items-center text-xs font-medium"
                          title="Per E-Mail versenden"
                          onClick={() => handleSendEmail(invoice)}
                        >
                          <Send className="h-3 w-3 mr-1" />
                          <span className="hidden xl:inline">Versenden</span>
                        </button>
                      )}
                      {(invoice.status === 'sent' || invoice.status === 'overdue' || invoice.status === 'reminded_1x' || invoice.status === 'reminded_2x' || invoice.status === 'reminded_3x') && (
                        <button
                          className="bg-green-100 hover:bg-green-200 text-green-700 hover:text-green-800 px-2 py-1 rounded-md transition-colors duration-200 shadow-sm flex items-center text-xs font-medium"
                          title="Als bezahlt markieren"
                          onClick={() => handleStatusChange(invoice.id, 'paid')}
                        >
                          <Check className="h-3 w-3 mr-1" />
                          <span className="hidden xl:inline">Bezahlt</span>
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex flex-wrap gap-1">
                      <button
                        onClick={() => handleOpenEditor(invoice)}
                        className="bg-primary-light-custom hover:bg-primary-medium-custom text-primary-custom hover:text-primary-custom p-1.5 rounded-md transition-colors duration-200 shadow-sm"
                        title={invoice.status === 'draft' ? 'Bearbeiten' : 'Details'}
                      >
                        {invoice.status === 'draft' ? <Edit className="h-3.5 w-3.5" /> : <Info className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => handlePreview(invoice)}
                        className="bg-blue-100 hover:bg-blue-200 text-blue-700 hover:text-blue-800 p-1.5 rounded-md transition-colors duration-200 shadow-sm"
                        title="Vorschau anzeigen"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button 
                        onClick={() => handleExport(invoice)}
                        disabled={isExporting === invoice.id}
                        className="bg-green-100 hover:bg-green-200 text-green-700 hover:text-green-800 p-1.5 rounded-md transition-colors duration-200 shadow-sm" 
                        title="Herunterladen"
                      >
                        {isExporting === invoice.id ? (
                          <div className="animate-spin h-3.5 w-3.5 border-2 border-green-600 border-t-transparent rounded-full"></div>
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => handleSendEmail(invoice)}
                        disabled={isSendingEmail === invoice.id}
                        className="bg-purple-100 hover:bg-purple-200 text-purple-700 hover:text-purple-800 p-1.5 rounded-md transition-colors duration-200 shadow-sm"
                        title="Per E-Mail versenden"
                      >
                        {isSendingEmail === invoice.id ? (
                          <div className="animate-spin h-3.5 w-3.5 border-2 border-purple-600 border-t-transparent rounded-full"></div>
                        ) : (
                          <Mail className="h-3.5 w-3.5" />
                        )}
                      </button>
                      {invoice.status === 'draft' && (
                        <button
                          onClick={() => handleDelete(invoice)}
                          className="bg-red-100 hover:bg-red-200 text-red-700 hover:text-red-800 p-1.5 rounded-md transition-colors duration-200 shadow-sm"
                          title="Löschen"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {isCancellable(invoice) && (
                        <button
                          onClick={() => setCancelRequest({ invoice, mode: 'cancel' })}
                          className="bg-red-100 hover:bg-red-200 text-red-700 hover:text-red-800 p-1.5 rounded-md transition-colors duration-200 shadow-sm"
                          title="Stornieren"
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden">
          {/* Mobile Select All */}
          <div className="p-4 border-b bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  checked={
                    filteredInvoices.length > 0 &&
                    filteredInvoices.every(invoice => selectedInvoiceIds.includes(invoice.id))
                  }
                  className="custom-checkbox"
                  title="Alle auswählen"
                />
                <span className="ml-2 text-sm text-gray-600">Alle auswählen</span>
              </div>
              <span className="text-xs text-gray-500">
                {filteredInvoices.length} Rechnung(en)
              </span>
            </div>
          </div>
          
          {filteredInvoices.map((invoice) => (
            <div key={invoice.id} onClick={(e) => { if ((e.target as HTMLElement).closest('button, a, input, label, select, textarea')) return; handleOpenEditor(invoice); }} className="cursor-pointer p-4 border-b border-gray-200 last:border-b-0">
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0 pt-1">
                  <input
                    type="checkbox"
                    checked={selectedInvoiceIds.includes(invoice.id)}
                    onChange={(e) => handleInvoiceSelection(invoice.id, e.target.checked)}
                    className="custom-checkbox"
                    title="Rechnung auswählen"
                  />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-gray-900 truncate">{invoice.invoiceNumber}</h3>
                      {cancellationNote(invoice) && (
                        <p className="text-xs text-gray-500 truncate">{cancellationNote(invoice)}</p>
                      )}
                      <p className="text-sm text-gray-600 truncate">{invoice.customerName}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {new Date(invoice.issueDate).toLocaleDateString('de-DE')} - Fällig: {new Date(invoice.dueDate).toLocaleDateString('de-DE')}
                      </p>
                    </div>
                    <div className="text-right ml-4">
                      <p className="text-sm font-medium text-gray-900">{formatCurrency(invoice.total, locale)}</p>
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(invoice.status)}`}>
                        {getInvoiceStatusLabel(invoice)}
                      </span>
                    </div>
                  </div>

                  {/* Action buttons for mobile */}
                  <div className="flex flex-wrap gap-2 mt-3">
                    {(invoice.status === 'draft' || isUnsentCancellation(invoice, unarchivedIds)) && (
                      <button
                        className="bg-primary-light-custom hover:bg-primary-medium-custom text-primary-custom hover:text-primary-custom px-3 py-1 rounded-md transition-colors duration-200 shadow-sm flex items-center text-xs font-medium"
                        onClick={() => handleSendEmail(invoice)}
                      >
                        <Send className="h-3 w-3 mr-1" />
                        <span>Versenden</span>
                      </button>
                    )}
                    {(invoice.status === 'sent' || invoice.status === 'overdue' || invoice.status === 'reminded_1x' || invoice.status === 'reminded_2x' || invoice.status === 'reminded_3x') && (
                      <button
                        className="bg-green-100 hover:bg-green-200 text-green-700 hover:text-green-800 px-3 py-1 rounded-md transition-colors duration-200 shadow-sm flex items-center text-xs font-medium"
                        onClick={() => handleStatusChange(invoice.id, 'paid')}
                      >
                        <Check className="h-3 w-3 mr-1" />
                        <span>Bezahlt</span>
                      </button>
                    )}
                    
                    <div className="flex space-x-1">
                      <button
                        onClick={() => handleOpenEditor(invoice)}
                        className="bg-primary-light-custom hover:bg-primary-medium-custom text-primary-custom hover:text-primary-custom p-2 rounded-md transition-colors duration-200 shadow-sm"
                        title={invoice.status === 'draft' ? 'Bearbeiten' : 'Details'}
                      >
                        {invoice.status === 'draft' ? <Edit className="h-3 w-3" /> : <Info className="h-3 w-3" />}
                      </button>
                      
                      <button
                        onClick={() => handlePreview(invoice)}
                        className="bg-blue-100 hover:bg-blue-200 text-blue-700 hover:text-blue-800 p-2 rounded-md transition-colors duration-200 shadow-sm"
                        title="Vorschau anzeigen"
                      >
                        <Eye className="h-3 w-3" />
                      </button>
                      
                      <button 
                        onClick={() => handleExport(invoice)}
                        disabled={isExporting === invoice.id}
                        className="bg-green-100 hover:bg-green-200 text-green-700 hover:text-green-800 p-2 rounded-md transition-colors duration-200 shadow-sm" 
                        title="Herunterladen"
                      >
                        {isExporting === invoice.id ? (
                          <div className="animate-spin h-3 w-3 border-2 border-green-600 border-t-transparent rounded-full"></div>
                        ) : (
                          <Download className="h-3 w-3" />
                        )}
                      </button>
                      
                      <button
                        onClick={() => handleSendEmail(invoice)}
                        disabled={isSendingEmail === invoice.id}
                        className="bg-purple-100 hover:bg-purple-200 text-purple-700 hover:text-purple-800 p-2 rounded-md transition-colors duration-200 shadow-sm"
                        title="Per E-Mail versenden"
                      >
                        {isSendingEmail === invoice.id ? (
                          <div className="animate-spin h-3 w-3 border-2 border-purple-600 border-t-transparent rounded-full"></div>
                        ) : (
                          <Mail className="h-3 w-3" />
                        )}
                      </button>
                      
                      {invoice.status === 'draft' && (
                        <button
                          onClick={() => handleDelete(invoice)}
                          className="bg-red-100 hover:bg-red-200 text-red-700 hover:text-red-800 p-2 rounded-md transition-colors duration-200 shadow-sm"
                          title="Löschen"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                      {isCancellable(invoice) && (
                        <button
                          onClick={() => setCancelRequest({ invoice, mode: 'cancel' })}
                          className="bg-red-100 hover:bg-red-200 text-red-700 hover:text-red-800 p-2 rounded-md transition-colors duration-200 shadow-sm"
                          title="Stornieren"
                        >
                          <Ban className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {filteredInvoices.length === 0 && (
          <div className="text-center py-8">
            <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">Keine Rechnungen gefunden</p>
          </div>
        )}
      </div>
      
      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
        isDestructive={confirmModal.isDestructive}
      />

      {detailsInvoice && (
        <InvoiceDetailsModal
          invoice={invoices.find(inv => inv.id === detailsInvoice.id) ?? detailsInvoice}
          locale={locale}
          statusLabel={getInvoiceStatusLabel(invoices.find(inv => inv.id === detailsInvoice.id) ?? detailsInvoice)}
          onClose={() => setDetailsInvoice(null)}
          onDownload={invoice => { setDetailsInvoice(null); handleExport(invoice); }}
          onCancel={(invoice, mode) => setCancelRequest({ invoice, mode })}
        />
      )}

      {cancelRequest && (
        <CancelInvoiceModal
          invoice={cancelRequest.invoice}
          mode={cancelRequest.mode}
          isLoading={isCancelling}
          onClose={() => setCancelRequest(null)}
          onConfirm={handleCancelConfirm}
        />
      )}
      
      {/* Email Send Modal */}
      <EmailSendModal
        isOpen={emailModal.isOpen}
        onClose={handleEmailModalClose}
        onSend={handleEmailSend}
        document={emailModal.invoice!}
        documentType="invoice"
        customer={emailModal.customer!}
        isLoading={isSendingEmail === emailModal.invoice?.id || isBulkOperation}
        isBulkMode={emailModal.isBulkMode}
        bulkCount={emailModal.bulkInvoices?.length || 0}
      />
      
      {/* Download Modal */}
      <DownloadModal
        isOpen={downloadModal.isOpen}
        onClose={() => setDownloadModal({ isOpen: false, invoice: null, isBulkMode: false, bulkInvoices: [] })}
        onDownload={handleDownloadConfirm}
        invoice={downloadModal.invoice!}
        isLoading={isExporting === downloadModal.invoice?.id || isBulkOperation}
        isBulkMode={downloadModal.isBulkMode}
        bulkCount={downloadModal.bulkInvoices?.length || 0}
      />

      {/* Document Preview Modal */}
      <DocumentPreview
        isOpen={documentPreview.isOpen}
        onClose={handleClosePreview}
        documents={documentPreview.documents}
        initialIndex={documentPreview.initialIndex}
      />

    </div>
  );
}