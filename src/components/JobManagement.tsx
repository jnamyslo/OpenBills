import React, { useState, useMemo, useEffect } from 'react';
import logger from '../utils/logger';
import { withJobContent } from '../utils/attachmentContent';
import { Plus, Edit, Trash2, FileText, FileCheck, Search, Check, Info, X, AlertTriangle, Briefcase, Download, Eye, PenTool } from 'lucide-react';
import { useCustomers } from '../context/CustomerContext';
import { useJobs } from '../context/JobContext';
import { useInvoices } from '../context/InvoiceContext';
import { documentHash } from '../utils/documentFlow';
import { useCompany } from '../context/CompanyContext';
import { JobEntry } from '../types';
import { JobEntryForm } from './JobEntryForm';
import { JobInvoiceGenerator } from './JobInvoiceGenerator';
import { ConfirmationModal } from './ConfirmationModal';
import { SignaturePad } from './SignaturePad';
import { DocumentPreview, PreviewDocument } from './DocumentPreview';
import { createJobAttachmentPreviewDocuments } from '../utils/previewDocuments';
import { generateJobPDF, downloadBlob } from '../utils/pdfGenerator';
import { calculateTotalHours } from '../utils/jobUtils';
import { clearCreateRoute } from '../utils/quickActions';
import { useJobInvoicing } from '../hooks/useJobInvoicing';

interface JobManagementProps {
  onNavigate?: (page: string) => void;
  /** Über Dashboard-Schnellaktion (#jobs/new): Formular für neuen Auftrag direkt öffnen. */
  autoCreate?: boolean;
  /** Über die Belegkette (#jobs/all/AB-…): Status-Filter und Suche vorbelegen. */
  initialFilter?: string;
  initialSearchTerm?: string;
}

export function JobManagement({ onNavigate, autoCreate, initialFilter, initialSearchTerm }: JobManagementProps = {}) {
  const { customers } = useCustomers();
  const { jobEntries, addJobEntry, updateJobEntry, deleteJobEntry, refreshJobEntries, addJobSignature } = useJobs();
  const { company } = useCompany();
  const { invoices } = useInvoices();
  const { createInvoiceForJobs } = useJobInvoicing();

  const goToInvoice = (job: JobEntry) => {
    const invoice = invoices.find(i => i.id === job.invoiceId);
    if (invoice) window.location.hash = documentHash('invoice', { id: invoice.id, number: invoice.invoiceNumber });
  };

  const [showForm, setShowForm] = useState(false);
  const [editingJob, setEditingJob] = useState<JobEntry | null>(null);
  const [showInvoiceGenerator, setShowInvoiceGenerator] = useState(false);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [isBulkOperation, setIsBulkOperation] = useState(false);
  const [convertingJobId, setConvertingJobId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('not-invoiced');
  const [customerFilter, setCustomerFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');
  
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDestructive?: boolean;
    isGoBDWarning?: boolean;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // Signature Pad state
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [signingJob, setSigningJob] = useState<JobEntry | null>(null);

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

  useEffect(() => {
    if (initialFilter) setStatusFilter(initialFilter);
    if (initialSearchTerm) setSearchTerm(initialSearchTerm);
  }, [initialFilter, initialSearchTerm]);

  // Dashboard-Schnellaktion: direkt neu anlegen
  useEffect(() => {
    if (!autoCreate) return;
    setShowForm(true);
    clearCreateRoute('jobs');
  }, [autoCreate]);

  // Get locale from company settings
  const locale = company?.locale || 'de-DE';

  // Filter and search jobs
  const filteredJobs = useMemo(() => {
    return jobEntries.filter(job => {
      const jobTitle = job.title || '';
      const jobDescription = job.description || '';
      const jobCustomerName = job.customerName || '';
      const jobJobNumber = job.jobNumber || '';
      const jobExternalJobNumber = job.externalJobNumber || '';
      const searchTermLower = searchTerm.toLowerCase();

      const matchesSearch = jobTitle.toLowerCase().includes(searchTermLower) ||
                           jobDescription.toLowerCase().includes(searchTermLower) ||
                           jobCustomerName.toLowerCase().includes(searchTermLower) ||
                           jobJobNumber.toLowerCase().includes(searchTermLower) ||
                           jobExternalJobNumber.toLowerCase().includes(searchTermLower);
      
      let matchesStatus = false;
      if (statusFilter === 'all') {
        matchesStatus = true;
      } else if (statusFilter === 'not-invoiced') {
        matchesStatus = job.status !== 'invoiced';
      } else {
        matchesStatus = job.status === statusFilter;
      }
      const matchesCustomer = customerFilter === 'all' || job.customerId === customerFilter;
      
      let matchesDate = true;
      if (dateFilter !== 'all') {
        const jobDate = new Date(job.date);
        const now = new Date();
        
        switch (dateFilter) {
          case 'today':
            matchesDate = jobDate.toDateString() === now.toDateString();
            break;
          case 'week': {
            const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            matchesDate = jobDate >= weekAgo;
            break;
          }
          case 'month': {
            // Clamp the day to the previous month's length so e.g. the 31st
            // doesn't overflow into the following month (new Date(y, m, 32)
            // silently rolls forward).
            const lastDayPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
            const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), lastDayPrevMonth));
            matchesDate = jobDate >= monthAgo;
            break;
          }
        }
      }
      
      return matchesSearch && matchesStatus && matchesCustomer && matchesDate;
    });
  }, [jobEntries, searchTerm, statusFilter, customerFilter, dateFilter]);

  // Abgeschlossene Aufträge sind abrechenbar
  const completedFilteredJobs = filteredJobs.filter(job => job.status === 'completed');
  const selectedCompletedJobIds = selectedJobIds.filter(jobId => {
    const job = jobEntries.find(j => j.id === jobId);
    return job && job.status === 'completed';
  });
  const skippedSelectedCount = selectedJobIds.length - selectedCompletedJobIds.length;

  const handleEdit = (job: JobEntry) => {
    // Check if job is invoiced and warn user
    if (job.status === 'invoiced') {
      setConfirmModal({
        isOpen: true,
        title: 'Auftrag bearbeiten',
        message: 'Dieser Auftrag wurde bereits abgerechnet. Änderungen an abgerechneten Aufträgen sollten nur in Ausnahmefällen vorgenommen werden, da sie die GoBD-Konformität beeinträchtigen können. Möchten Sie trotzdem fortfahren?',
        onConfirm: () => {
          setEditingJob(job);
          setShowForm(true);
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        },
        isGoBDWarning: true
      });
    } else {
      setEditingJob(job);
      setShowForm(true);
    }
  };

  // Klick auf eine Zeile öffnet den Auftrag; Klicks auf Bedienelemente in der Zeile nicht
  const handleRowClick = (e: React.MouseEvent, job: JobEntry) => {
    if ((e.target as HTMLElement).closest('button, a, input, label, select, textarea')) return;
    handleEdit(job);
  };

  const handleDelete = (job: JobEntry) => {
    // Check if job is invoiced and warn user
    if (job.status === 'invoiced') {
      setConfirmModal({
        isOpen: true,
        title: 'Auftrag löschen',
        message: 'Dieser Auftrag wurde bereits abgerechnet. Das Löschen abgerechneter Aufträge kann die GoBD-Konformität verletzen und ist rechtlich problematisch. Sind Sie sicher, dass Sie fortfahren möchten?',
        onConfirm: async () => {
          try {
            await deleteJobEntry(job.id);
            setConfirmModal(prev => ({ ...prev, isOpen: false }));
          } catch (error) {
            logger.error('Error deleting job', { error });
            alert('Fehler beim Löschen des Auftrags. Bitte versuchen Sie es erneut.');
          }
        },
        isDestructive: true,
        isGoBDWarning: true
      });
    } else {
      setConfirmModal({
        isOpen: true,
        title: 'Auftrag löschen',
        message: `Möchten Sie den Auftrag "${job.title}" wirklich löschen?`,
        onConfirm: async () => {
          try {
            await deleteJobEntry(job.id);
            setConfirmModal(prev => ({ ...prev, isOpen: false }));
          } catch (error) {
            logger.error('Error deleting job', { error });
            alert('Fehler beim Löschen des Auftrags. Bitte versuchen Sie es erneut.');
          }
        },
        isDestructive: true
      });
    }
  };

  const handleFormSubmit = async (jobData: Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      if (editingJob) {
        await updateJobEntry(editingJob.id, jobData);
        // Refresh job entries in other components
        await refreshJobEntries();
      } else {
        await addJobEntry(jobData);
        // Refresh job entries in other components
        await refreshJobEntries();
      }
      setShowForm(false);
      setEditingJob(null);
    } catch (error) {
      logger.error('Error saving job', { error });
      // Formular bleibt offen, damit der Nutzer es erneut versuchen kann.
      alert('Fehler beim Speichern des Auftrags. Bitte versuchen Sie es erneut.');
    }
  };

  const handleStatusChange = async (jobId: string, newStatus: JobEntry['status']) => {
    try {
      // Check if current status is invoiced - prevent changes
      const currentJob = jobEntries.find((j) => j.id === jobId);
      if (currentJob?.status === 'invoiced') {
        setConfirmModal({
          isOpen: true,
          title: 'Status nicht änderbar',
          message: 'Der Status von abgerechneten Aufträgen kann nicht mehr geändert werden.',
          onConfirm: () => {
            setConfirmModal((prev) => ({ ...prev, isOpen: false }));
          }
        });
        return;
      }
      
      await updateJobEntry(jobId, { status: newStatus });
    } catch (error) {
      logger.error('Error updating job status', { error });
      alert('Fehler beim Ändern des Status. Bitte versuchen Sie es erneut.');
    }
  };

  const getStatusColor = (status: JobEntry['status']) => {
    switch (status) {
      case 'draft': return 'text-gray-600 bg-gray-100';
      case 'in-progress': return 'text-yellow-600 bg-yellow-100';
      case 'completed': return 'text-green-600 bg-green-100';
      case 'invoiced': return 'text-blue-600 bg-blue-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getStatusLabel = (status: JobEntry['status']) => {
    switch (status) {
      case 'draft': return 'Entwurf';
      case 'in-progress': return 'In Bearbeitung';
      case 'completed': return 'Abgeschlossen';
      case 'invoiced': return 'Abgerechnet';
      default: return status;
    }
  };

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'high': return 'text-red-600';
      case 'medium': return 'text-yellow-600';
      case 'low': return 'text-green-600';
      default: return 'text-gray-600';
    }
  };

  const handleJobSelection = (jobId: string, checked: boolean) => {
    // Allow selection of all jobs, not just completed ones
    if (checked) {
      setSelectedJobIds(prev => [...prev, jobId]);
    } else {
      setSelectedJobIds(prev => prev.filter(id => id !== jobId));
    }
  };

  // Einzelner Auftrag: direkt in Rechnung (Entwurf) umwandeln und im Editor öffnen
  const handleConvertToInvoice = async (job: JobEntry) => {
    if (job.status !== 'completed' || convertingJobId) return;
    setConvertingJobId(job.id);
    try {
      const invoice = await createInvoiceForJobs([job]);
      if (!invoice) {
        alert('Kunde des Auftrags nicht gefunden.');
        return;
      }
      setSelectedJobIds([]);
      window.location.hash = `invoices/edit/${invoice.id}`;
    } catch (error) {
      logger.error('Error converting job to invoice', { error, jobId: job.id });
      alert('Fehler beim Erstellen der Rechnung. Bitte versuchen Sie es erneut.');
    } finally {
      setConvertingJobId(null);
    }
  };

  // Auswahl: ein abgeschlossener Auftrag → direkt umwandeln, mehrere → Sammelrechnung
  const handleBulkInvoiceGeneration = () => {
    if (selectedCompletedJobIds.length === 0) return;
    if (selectedCompletedJobIds.length === 1) {
      const job = jobEntries.find(j => j.id === selectedCompletedJobIds[0]);
      if (job) handleConvertToInvoice(job);
      return;
    }
    setShowInvoiceGenerator(true);
  };

  // Bulk operations functions
  const handleSelectAllJobs = (checked: boolean) => {
    if (checked) {
      // Select ALL jobs, not just completed ones
      setSelectedJobIds(filteredJobs.map(job => job.id));
    } else {
      setSelectedJobIds([]);
    }
  };

  const handleBulkStatusChange = async (newStatus: JobEntry['status']) => {
    if (selectedJobIds.length === 0) return;
    
    setIsBulkOperation(true);
    try {
      // Skip invoiced jobs — their status is locked (GoBD), matching the
      // single-job guard in handleStatusChange.
      const targetJobs = selectedJobIds.filter(jobId => {
        const job = jobEntries.find((j) => j.id === jobId);
        return job?.status !== 'invoiced';
      });
      const skippedCount = selectedJobIds.length - targetJobs.length;

      // Fehler pro Auftrag abfangen, damit ein Fehlschlag nicht den Rest
      // des Stapels abbricht.
      let successCount = 0;
      let errorCount = 0;
      for (const jobId of targetJobs) {
        try {
          await updateJobEntry(jobId, { status: newStatus });
          successCount++;
        } catch (error) {
          logger.error('Error updating job status', { error, jobId });
          errorCount++;
        }
      }
      setSelectedJobIds([]);
      const parts = [`${successCount} Auftrag/Aufträge erfolgreich aktualisiert.`];
      if (skippedCount > 0) {
        parts.push(`${skippedCount} abgerechnete(r) Auftrag/Aufträge übersprungen.`);
      }
      if (errorCount > 0) {
        parts.push(`${errorCount} fehlgeschlagen.`);
      }
      alert(parts.join(' '));
    } catch (error) {
      logger.error('Error updating job statuses', { error });
      alert('Fehler beim Aktualisieren der Aufträge.');
    } finally {
      setIsBulkOperation(false);
    }
  };

  const handleBulkDownload = async () => {
    if (selectedJobIds.length === 0) return;
    
    setIsBulkOperation(true);
    let successCount = 0;
    try {
      for (const jobId of selectedJobIds) {
        const job = jobEntries.find(j => j.id === jobId);
        const customer = job ? customers.find(c => c.id === job.customerId) : null;

        if (job && customer && company) {
          const pdfBlob = await generateJobPDF(job, {
            company,
            customer
          });

          const fileName = `Auftrag_${job.jobNumber || job.id}_${job.customerName || customer.name}.pdf`;
          downloadBlob(pdfBlob, fileName);
          successCount++;

          // Add delay between downloads to prevent browser issues
          if (selectedJobIds.indexOf(jobId) < selectedJobIds.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }
      setSelectedJobIds([]);
      alert(`${successCount} Auftrag/Aufträge erfolgreich heruntergeladen.`);
    } catch (error) {
      logger.error('Error downloading jobs:', error);
      alert('Fehler beim Herunterladen der Aufträge.');
    } finally {
      setIsBulkOperation(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedJobIds.length === 0) return;
    
    setConfirmModal({
      isOpen: true,
      title: 'Aufträge löschen',
      message: `Sind Sie sicher, dass Sie ${selectedJobIds.length} Auftrag/Aufträge löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.`,
      onConfirm: async () => {
        setIsBulkOperation(true);
        try {
          // Fehler pro Auftrag abfangen, damit ein Fehlschlag nicht den Rest
          // des Stapels abbricht.
          let successCount = 0;
          let errorCount = 0;
          for (const jobId of selectedJobIds) {
            try {
              await deleteJobEntry(jobId);
              successCount++;
            } catch (error) {
              logger.error('Error deleting job', { error, jobId });
              errorCount++;
            }
          }
          setSelectedJobIds([]);
          alert(errorCount > 0
            ? `${successCount} Auftrag/Aufträge gelöscht, ${errorCount} fehlgeschlagen.`
            : `${successCount} Auftrag/Aufträge erfolgreich gelöscht.`);
        } catch (error) {
          logger.error('Error deleting jobs', { error });
          alert('Fehler beim Löschen der Aufträge.');
        } finally {
          setIsBulkOperation(false);
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        }
      },
      isDestructive: true
    });
  };

  const handleExportJobPDF = async (job: JobEntry) => {
    try {
      const customer = customers.find(c => c.id === job.customerId);
      if (!customer || !company) {
        alert('Kunden- oder Firmendaten nicht gefunden');
        return;
      }

      const pdfBlob = await generateJobPDF(job, {
        company,
        customer
      });

      const filename = `Auftrag_${job.title.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date(job.date).toLocaleDateString('de-DE').replace(/\./g, '-')}.pdf`;
      downloadBlob(pdfBlob, filename);
    } catch (error) {
      logger.error('Fehler beim Erstellen der Auftrags-PDF:', error);
      alert('Fehler beim Erstellen der PDF. Bitte versuchen Sie es erneut.');
    }
  };

  const handlePreview = async (job: JobEntry) => {
    // Create preview documents for the job (Anhang-Inhalte bei Bedarf nachladen)
    let documents: PreviewDocument[];
    try {
      documents = createJobAttachmentPreviewDocuments(await withJobContent(job));
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

  const handleSignature = (job: JobEntry) => {
    // Check if job is already completed or invoiced
    if (job.status === 'completed' || job.status === 'invoiced') {
      alert('Dieser Auftrag ist bereits abgeschlossen oder abgerechnet.');
      return;
    }
    
    setSigningJob(job);
    setShowSignaturePad(true);
  };

  const handleSignatureSave = async (signatureData: string, customerName: string) => {
    if (!signingJob) {
      alert('Fehler: Kein Auftrag zum Signieren gefunden.');
      return;
    }
    
    try {
      await addJobSignature(signingJob.id, signatureData, customerName);
      setShowSignaturePad(false);
      setSigningJob(null);
    } catch (error) {
      logger.error('JobManagement: Error adding signature:', error);
      alert('Fehler beim Speichern der Unterschrift. Bitte versuchen Sie es erneut.');
    }
  };

  const handleSignatureClose = () => {
    setShowSignaturePad(false);
    setSigningJob(null);
  };

  if (showForm) {
    return (
      <JobEntryForm
        job={editingJob}
        customers={customers}
        onSubmit={handleFormSubmit}
        onCancel={() => {
          setShowForm(false);
          setEditingJob(null);
        }}
        onNavigateToCustomers={() => onNavigate && onNavigate('customers')}
        onNavigateToSettings={() => onNavigate && onNavigate('settings')}
      />
    );
  }

  if (showInvoiceGenerator) {
    // Only pass completed jobs — bulk selection can include non-completed jobs,
    // but only completed jobs may be invoiced (see handleBulkInvoiceGeneration).
    return (
      <JobInvoiceGenerator
        selectedJobIds={selectedCompletedJobIds}
        onClose={() => {
          setShowInvoiceGenerator(false);
          setSelectedJobIds([]);
        }}
        onInvoiceGenerated={() => {
          setShowInvoiceGenerator(false);
          setSelectedJobIds([]);
        }}
      />
    );
  }

  // Nächster Schritt je Status (wie bei Rechnungen/Angeboten in der Statusspalte)
  const renderNextStep = (job: JobEntry, mobile: boolean) => {
    const size = mobile ? 'px-3 py-1' : 'px-2 py-1';
    if (job.status === 'draft' || job.status === 'in-progress') {
      return (
        <button
          className={`bg-green-100 hover:bg-green-200 text-green-700 hover:text-green-800 ${size} rounded-md transition-colors duration-200 shadow-sm flex items-center text-xs font-medium`}
          title="Als abgeschlossen markieren"
          onClick={() => handleStatusChange(job.id, 'completed')}
        >
          <Check className="h-3 w-3 mr-1" />
          <span>Abschließen</span>
        </button>
      );
    }
    if (job.status === 'completed') {
      const isConverting = convertingJobId === job.id;
      return (
        <button
          className={`bg-blue-100 hover:bg-blue-200 text-blue-700 hover:text-blue-800 ${size} rounded-md transition-colors duration-200 shadow-sm flex items-center text-xs font-medium disabled:opacity-60`}
          title="In Rechnung umwandeln"
          onClick={() => handleConvertToInvoice(job)}
          disabled={convertingJobId !== null}
        >
          {isConverting ? (
            <div className="animate-spin h-3 w-3 mr-1 border-2 border-blue-600 border-t-transparent rounded-full"></div>
          ) : (
            <FileCheck className="h-3 w-3 mr-1" />
          )}
          <span>{isConverting ? 'Wird erstellt…' : 'In Rechnung umwandeln'}</span>
        </button>
      );
    }
    if (job.status === 'invoiced' && job.invoiceId && invoices.some(i => i.id === job.invoiceId)) {
      return (
        <button
          className={`bg-blue-100 hover:bg-blue-200 text-blue-700 hover:text-blue-800 ${size} rounded-md transition-colors duration-200 shadow-sm flex items-center text-xs font-medium`}
          title="Zur Rechnung"
          onClick={() => goToInvoice(job)}
        >
          <FileText className="h-3 w-3 mr-1" />
          <span>Zur Rechnung</span>
        </button>
      );
    }
    return null;
  };

  const renderActions = (job: JobEntry, mobile: boolean) => {
    const pad = mobile ? 'p-2' : 'p-1.5';
    const icon = mobile ? 'h-3 w-3' : 'h-3.5 w-3.5';
    return (
      <div className={mobile ? 'flex space-x-1' : 'flex flex-wrap gap-1'}>
        <button
          onClick={() => handleEdit(job)}
          className={`bg-primary-light-custom hover:bg-primary-medium-custom text-primary-custom hover:text-primary-custom ${pad} rounded-md transition-colors duration-200 shadow-sm`}
          title={job.status === 'invoiced' ? 'Bearbeiten (GoBD-Warnung wird angezeigt)' : 'Bearbeiten'}
        >
          <Edit className={icon} />
        </button>
        <button
          onClick={() => handlePreview(job)}
          className={`bg-blue-100 hover:bg-blue-200 text-blue-700 hover:text-blue-800 ${pad} rounded-md transition-colors duration-200 shadow-sm`}
          title="Dokumente anzeigen"
        >
          <Eye className={icon} />
        </button>
        <button
          onClick={() => handleExportJobPDF(job)}
          className={`bg-green-100 hover:bg-green-200 text-green-700 hover:text-green-800 ${pad} rounded-md transition-colors duration-200 shadow-sm`}
          title="PDF herunterladen"
        >
          <Download className={icon} />
        </button>
        {!job.signature && job.status !== 'completed' && job.status !== 'invoiced' && (
          <button
            onClick={() => handleSignature(job)}
            className={`bg-purple-100 hover:bg-purple-200 text-purple-700 hover:text-purple-800 ${pad} rounded-md transition-colors duration-200 shadow-sm`}
            title="Unterschrift hinzufügen"
          >
            <PenTool className={icon} />
          </button>
        )}
        <button
          onClick={() => handleDelete(job)}
          className={`bg-red-100 hover:bg-red-200 text-red-700 hover:text-red-800 ${pad} rounded-md transition-colors duration-200 shadow-sm`}
          title={job.status === 'invoiced' ? 'Löschen (GoBD-Warnung wird angezeigt)' : 'Löschen'}
        >
          <Trash2 className={icon} />
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-2xl lg:text-3xl font-bold text-gray-900">Aufträge</h2>
          <p className="text-gray-600 mt-1">Verwalten Sie Ihre Aufträge</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="btn-primary text-white px-4 py-2 rounded-xl flex items-center justify-center space-x-2 hover:brightness-90 transition-all duration-300 hover:scale-105"
        >
          <Plus className="h-5 w-5" />
          <span className="hidden sm:inline">Neuer Auftrag</span>
          <span className="sm:hidden">Neu</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="h-5 w-5 absolute left-3 top-3 text-gray-400" />
            <input
              type="text"
              placeholder="Aufträge suchen..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Alle Status</option>
            <option value="not-invoiced">Alle außer abgerechnet</option>
            <option value="draft">Entwurf</option>
            <option value="in-progress">In Bearbeitung</option>
            <option value="completed">Abgeschlossen</option>
            <option value="invoiced">Abgerechnet</option>
          </select>
          <select
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Alle Kunden</option>
            {customers.map(customer => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Alle Zeiträume</option>
            <option value="today">Heute</option>
            <option value="week">Diese Woche</option>
            <option value="month">Dieser Monat</option>
          </select>
        </div>
      </div>

      {/* Bulk Operations Bar */}
      {selectedJobIds.length > 0 ? (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex flex-col">
              <span className="text-sm text-blue-800 font-medium">
                {selectedJobIds.length} Auftrag/Aufträge ausgewählt
              </span>
              {selectedCompletedJobIds.length > 0 && skippedSelectedCount > 0 && (
                <span className="text-xs text-blue-700 mt-1">
                  {skippedSelectedCount} nicht abgeschlossen, werden bei der Abrechnung übersprungen
                </span>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              {/* Bulk Status Change */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-blue-800">Status ändern:</span>
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      handleBulkStatusChange(e.target.value as JobEntry['status']);
                      e.target.value = '';
                    }
                  }}
                  disabled={isBulkOperation}
                  className="text-xs px-2 py-1 border border-blue-300 rounded focus:ring-2 focus:ring-blue-500"
                  defaultValue=""
                >
                  <option value="">Wählen...</option>
                  <option value="draft">Entwurf</option>
                  <option value="in-progress">In Bearbeitung</option>
                  <option value="completed">Abgeschlossen</option>
                  <option value="invoiced">Abgerechnet</option>
                </select>
              </div>

              {/* Rechnung: einer → direkt, mehrere → Sammelrechnung */}
              <button
                onClick={handleBulkInvoiceGeneration}
                disabled={isBulkOperation || convertingJobId !== null || selectedCompletedJobIds.length === 0}
                title={selectedCompletedJobIds.length === 0 ? 'Nur abgeschlossene Aufträge können abgerechnet werden' : undefined}
                className="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 transition-colors flex items-center text-sm disabled:bg-gray-400"
              >
                <FileCheck className="h-4 w-4 mr-1" />
                {selectedCompletedJobIds.length >= 2
                  ? `Sammelrechnung erstellen (${selectedCompletedJobIds.length})`
                  : 'In Rechnung umwandeln'}
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

              {/* Bulk Delete */}
              <button
                onClick={handleBulkDelete}
                disabled={isBulkOperation}
                className="bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 transition-colors flex items-center text-sm disabled:bg-gray-400"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Löschen
              </button>

              {/* Clear Selection */}
              <button
                onClick={() => setSelectedJobIds([])}
                className="bg-gray-500 text-white px-3 py-1 rounded hover:bg-gray-600 transition-colors flex items-center text-sm"
              >
                <X className="h-4 w-4 mr-1" />
                Auswahl aufheben
              </button>
            </div>
          </div>
        </div>
      ) : completedFilteredJobs.length >= 2 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start">
            <Info className="h-4 w-4 text-blue-600 mr-2 mt-0.5 flex-shrink-0" />
            <span className="text-sm text-blue-800">
              {completedFilteredJobs.length} abgeschlossene Aufträge bereit zur Abrechnung. Mehrere auswählen, um sie in einer Sammelrechnung abzurechnen.
            </span>
          </div>
          <button
            onClick={() => setSelectedJobIds(completedFilteredJobs.map(job => job.id))}
            className="bg-white border border-blue-300 text-blue-700 px-3 py-1 rounded hover:bg-blue-100 transition-colors text-sm whitespace-nowrap"
          >
            Alle abgeschlossenen auswählen
          </button>
        </div>
      )}

      {/* Job List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        {filteredJobs.length === 0 ? (
          <div className="p-8 lg:p-12 text-center">
            <Briefcase className="h-12 w-12 lg:h-16 lg:w-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg lg:text-xl font-medium text-gray-900 mb-2">Keine Aufträge gefunden</h3>
            <p className="text-gray-500 mb-6">
              {jobEntries.length > 0 && (searchTerm || statusFilter !== 'all' || customerFilter !== 'all' || dateFilter !== 'all')
                ? 'Versuchen Sie andere Filter oder erstellen Sie einen neuen Auftrag.'
                : 'Erstellen Sie Ihren ersten Auftrag, um loszulegen.'}
            </p>

            {/* Info box für neue Benutzer */}
            {jobEntries.length === 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 text-left max-w-md mx-auto">
                <h4 className="text-sm font-medium text-blue-900 mb-2">So funktioniert die Abrechnung:</h4>
                <ol className="text-sm text-blue-800 space-y-1">
                  <li>1. Auftrag erstellen und Arbeitszeit erfassen</li>
                  <li>2. Auftrag abschließen</li>
                  <li>3. Einzeln: „In Rechnung umwandeln“ in der Zeile</li>
                  <li>4. Mehrere: Aufträge anhaken → „Sammelrechnung erstellen“</li>
                </ol>
              </div>
            )}

            <button
              onClick={() => setShowForm(true)}
              className="btn-primary text-white px-4 lg:px-6 py-2 lg:py-3 rounded-xl hover:brightness-90 transition-all duration-300 hover:scale-105"
            >
              Ersten Auftrag erstellen
            </button>
          </div>
        ) : (
          <>
            {/* Desktop/Tablet Table View */}
            <div className="hidden md:block overflow-x-auto scrollbar-hide">
              <div className="min-w-full overflow-hidden">
                <table className="w-full min-w-[900px]">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-3 text-left w-16">
                        <input
                          type="checkbox"
                          onChange={(e) => handleSelectAllJobs(e.target.checked)}
                          checked={filteredJobs.every((job: JobEntry) => selectedJobIds.includes(job.id))}
                          className="custom-checkbox"
                          title="Alle auswählen"
                        />
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                        Nr.
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Auftrag
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Kunde
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                        Datum
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                        Std.
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-40">
                        Status
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48">
                        Aktionen
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredJobs.map((job) => (
                      <tr key={job.id} onClick={(e) => handleRowClick(e, job)} className="cursor-pointer hover:bg-gray-50">
                        <td className="px-3 py-4 w-16">
                          <input
                            type="checkbox"
                            checked={selectedJobIds.includes(job.id)}
                            onChange={(e) => handleJobSelection(job.id, e.target.checked)}
                            className="custom-checkbox"
                            title="Auftrag auswählen"
                          />
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {job.jobNumber}
                          {job.externalJobNumber && (
                            <div className="text-xs font-normal text-gray-500">Ext: {job.externalJobNumber}</div>
                          )}
                        </td>
                        <td className="px-3 py-4">
                          <div className="text-sm font-medium text-gray-900 flex items-center">
                            {job.priority && (
                              <AlertTriangle className={`h-4 w-4 mr-2 flex-shrink-0 ${getPriorityColor(job.priority)}`} />
                            )}
                            <span className="truncate">{job.title}</span>
                          </div>
                          <div className="text-sm text-gray-500 truncate max-w-xs">
                            {job.description}
                          </div>
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900">
                          {job.customerName}
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900">
                          {new Date(job.date).toLocaleDateString(locale)}
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900">
                          {calculateTotalHours(job).toFixed(1)}h
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap">
                          <div className="flex flex-col space-y-1">
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(job.status)}`}>
                              {getStatusLabel(job.status)}
                            </span>
                            {renderNextStep(job, false)}
                          </div>
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap text-sm font-medium">
                          {renderActions(job, false)}
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
                      onChange={(e) => handleSelectAllJobs(e.target.checked)}
                      checked={filteredJobs.every((job: JobEntry) => selectedJobIds.includes(job.id))}
                      className="custom-checkbox"
                      title="Alle auswählen"
                    />
                    <span className="ml-2 text-sm text-gray-600">Alle auswählen</span>
                  </div>
                  <span className="text-xs text-gray-500">
                    {filteredJobs.length} Auftrag/Aufträge
                  </span>
                </div>
              </div>

              {filteredJobs.map((job) => (
                <div key={job.id} onClick={(e) => handleRowClick(e, job)} className="cursor-pointer p-4 border-b border-gray-200 last:border-b-0">
                  <div className="flex items-start space-x-3">
                    <div className="flex-shrink-0 pt-1">
                      <input
                        type="checkbox"
                        checked={selectedJobIds.includes(job.id)}
                        onChange={(e) => handleJobSelection(job.id, e.target.checked)}
                        className="custom-checkbox"
                        title="Auftrag auswählen"
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-medium text-gray-900 truncate flex items-center">
                            {job.priority && (
                              <AlertTriangle className={`h-4 w-4 mr-1 flex-shrink-0 ${getPriorityColor(job.priority)}`} />
                            )}
                            {job.jobNumber}{job.externalJobNumber ? ` · Ext: ${job.externalJobNumber}` : ''}
                          </h3>
                          <p className="text-sm text-gray-900 truncate">{job.title}</p>
                          <p className="text-sm text-gray-600 truncate">{job.customerName}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            {new Date(job.date).toLocaleDateString(locale)} · {calculateTotalHours(job).toFixed(1)}h
                          </p>
                        </div>
                        <div className="text-right ml-4">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(job.status)}`}>
                            {getStatusLabel(job.status)}
                          </span>
                        </div>
                      </div>

                      {/* Action buttons for mobile */}
                      <div className="flex flex-wrap gap-2 mt-3">
                        {renderNextStep(job, true)}
                        {renderActions(job, true)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={confirmModal.onConfirm}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        isDestructive={confirmModal.isDestructive}
        isGoBDWarning={confirmModal.isGoBDWarning}
      />

      {/* Document Preview Modal */}
      <DocumentPreview
        isOpen={documentPreview.isOpen}
        onClose={handleClosePreview}
        documents={documentPreview.documents}
        initialIndex={documentPreview.initialIndex}
      />

      
      {/* Signature Pad Modal */}
      <SignaturePad
        isOpen={showSignaturePad}
        onClose={handleSignatureClose}
        onSave={handleSignatureSave}
        title="Kundenunterschrift"
        initialCustomerName={signingJob?.customerName || ''}
      />
    </div>
  );
}
