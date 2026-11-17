import React, { useEffect, useState } from 'react';
import logger from '../utils/logger';
import { withInvoiceContent } from '../utils/attachmentContent';
import { Clock, CheckCircle, Send, Check, Plus, FileText, UserPlus, FileCheck, Briefcase, Lock, Wallet, AlertTriangle, TrendingUp, type LucideIcon } from 'lucide-react';
import { useCustomers } from '../context/CustomerContext';
import { useInvoices } from '../context/InvoiceContext';
import { useCompany } from '../context/CompanyContext';
import { featureUpgradeReason, usePlan } from '../context/PlanContext';
import { useLoading } from '../context/AppContext';
import { formatCurrency } from '../utils/formatters';
import { blobToBase64 } from '../utils/blobUtils';
import { EmailSendModal } from './EmailSendModal';
import { generateInvoicePDF } from '../utils/pdfGenerator';
import { apiService, isPlanError } from '../services/api';
import { releaseForOutput } from '../utils/releaseForOutput';
import { Invoice } from '../types';

interface DashboardProps {
  onNavigate: (page: string, filter?: string, searchTerm?: string) => void;
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const { customers } = useCustomers();
  const { invoices, updateInvoice } = useInvoices();
  const { company } = useCompany();
  const { hasFeature, showUpgrade } = usePlan();
  const { loading } = useLoading();

  // Email modal state
  const [emailModal, setEmailModal] = useState<{
    isOpen: boolean;
    invoice: Invoice | null;
    customer: { email: string; additionalEmails?: { id: string; email: string; label?: string; isActive: boolean }[] } | null;
  }>({
    isOpen: false,
    invoice: null,
    customer: null
  });
  const [isSendingEmail, setIsSendingEmail] = useState<string | null>(null);

  // Get locale from company settings, default to 'de-DE'
  const locale = company?.locale || 'de-DE';

  const handleMarkAsPaid = async (invoiceId: string) => {
    try {
      await updateInvoice(invoiceId, { status: 'paid' });
    } catch (error) {
      logger.error('Error marking invoice as paid', { error });
      alert('Fehler beim Markieren als bezahlt. Bitte versuchen Sie es erneut.');
    }
  };

  const handleSendEmail = async (invoice) => {
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
    
    setIsSendingEmail(emailModal.invoice.id);
    
    try {
      // Combine selected emails and manual emails
      const allEmails = [...(selectedEmails || []), ...(manualEmails?.filter(email => email.trim()) || [])];
      
      if (allEmails.length === 0) {
        alert('Bitte wählen Sie mindestens eine E-Mail-Adresse aus.');
        return;
      }

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
        
        for (const attachment of selectedInvoiceAttachments) {
          processedAttachments.push({
            name: attachment.name,
            content: attachment.content,
            contentType: attachment.contentType
          });
        }
      }

      // Entwürfe werden vor dem Versand freigegeben (zählt gegen das Plan-Kontingent),
      // damit der Kunde kein Dokument mit Wasserzeichen erhält.
      const invoiceToSend = emailModal.invoice;
      await releaseForOutput(invoiceToSend, status => updateInvoice(invoiceToSend.id, { status }), async released => {
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
      
      alert(`Rechnung erfolgreich per E-Mail versendet! (${formatLabels.join(', ')})${attachmentInfo}`);
      
      // Close email dialog
      setEmailModal({ isOpen: false, invoice: null, customer: null });
    } catch (error) {
      logger.error('Fehler beim E-Mail-Versand:', error);
      // Tarif-Fehler zeigt der Upgrade-Dialog
      if (!isPlanError(error)) alert('Fehler beim E-Mail-Versand: ' + (error as Error).message);
    } finally {
      setIsSendingEmail(null);
    }
  };

  const handleEmailModalClose = () => {
    setEmailModal({ isOpen: false, invoice: null, customer: null });
  };

  // Check for overdue invoices automatically on every load
  useEffect(() => {
    const checkOverdueInvoices = async () => {
      if (loading || invoices.length === 0) return;
      
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
        logger.info(`${overdueUpdates.length} invoices automatically marked as overdue`, { count: overdueUpdates.length });
      }
    };

    // Run overdue check whenever data is loaded
    if (!loading && invoices.length > 0) {
      checkOverdueInvoices();
    }
  }, [loading, invoices, updateInvoice]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-custom mx-auto"></div>
          <p className="mt-4 text-gray-600">Lade Daten...</p>
        </div>
      </div>
    );
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const DAY_MS = 24 * 60 * 60 * 1000;

  const isOverdue = (status: string) => status === 'overdue' || status.startsWith('reminded_');
  const sumTotals = (list: Invoice[]) => list.reduce((sum, invoice) => sum + invoice.total, 0);
  // Umsatz = alle nicht-Entwurf-Rechnungen nach Rechnungsdatum
  const issuedInvoices = invoices.filter(invoice => invoice.status !== 'draft');
  const monthKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}`;

  const openInvoices = invoices.filter(invoice => invoice.status !== 'draft' && invoice.status !== 'paid');
  const overdueInvoices = invoices
    .filter(invoice => isOverdue(invoice.status))
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  const draftCount = invoices.filter(invoice => invoice.status === 'draft').length;

  // Letzte 6 Monate inkl. aktuellem Monat
  const lastMonths = Array.from({ length: 6 }, (_, i) => new Date(today.getFullYear(), today.getMonth() - 5 + i, 1));
  const monthlyRevenue = lastMonths.map(month => ({
    month,
    revenue: sumTotals(issuedInvoices.filter(invoice => monthKey(new Date(invoice.issueDate)) === monthKey(month))),
  }));
  const maxMonthlyRevenue = Math.max(...monthlyRevenue.map(m => m.revenue), 0);
  const currentMonthRevenue = monthlyRevenue[5].revenue;
  const previousMonthRevenue = monthlyRevenue[4].revenue;
  const revenueChange = previousMonthRevenue > 0
    ? Math.round(((currentMonthRevenue - previousMonthRevenue) / previousMonthRevenue) * 100)
    : null;

  const recentInvoices = [...invoices]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const getStatusColor = (status: string) => {
    if (status.startsWith('reminded_')) return 'bg-red-100 text-red-800';
    switch (status) {
      case 'paid': return 'bg-green-100 text-green-800';
      case 'sent': return 'bg-primary-custom/10 text-primary-custom';
      case 'draft': return 'bg-gray-100 text-gray-800';
      case 'overdue': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'paid': return 'Bezahlt';
      case 'sent': return 'Versendet';
      case 'draft': return 'Entwurf';
      case 'overdue': return 'Überfällig';
      case 'reminded_1x': return '1. Mahnung';
      case 'reminded_2x': return '2. Mahnung';
      case 'reminded_3x': return '3. Mahnung';
      default: return status;
    }
  };

  const remindersAvailable = company.remindersEnabled && hasFeature('reminders');
  const jobsAvailable = hasFeature('jobs');

  const quickActions: { id: string; label: string; icon: LucideIcon; onClick: () => void; locked?: boolean }[] = [
    { id: 'invoice', label: 'Neue Rechnung', icon: FileText, onClick: () => onNavigate('invoices', 'new') },
    { id: 'customer', label: 'Neuer Kunde', icon: UserPlus, onClick: () => onNavigate('customers', 'new') },
    ...(company.quotesEnabled
      ? [{ id: 'quote', label: 'Neues Angebot', icon: FileCheck, onClick: () => onNavigate('quote-editor') }]
      : []),
    ...(company.jobTrackingEnabled
      ? [{
          id: 'job',
          label: 'Neuer Auftrag',
          icon: Briefcase,
          locked: !jobsAvailable,
          onClick: () => (jobsAvailable ? onNavigate('jobs', 'new') : showUpgrade(featureUpgradeReason('jobs'))),
        }]
      : []),
  ];

  const kpis = [
    {
      id: 'open',
      label: 'Offene Forderungen',
      value: formatCurrency(sumTotals(openInvoices), locale),
      hint: `${openInvoices.length} ${openInvoices.length === 1 ? 'Rechnung' : 'Rechnungen'} unbezahlt`,
      icon: Wallet,
      accent: 'text-primary-custom bg-primary-light-custom',
      onClick: () => onNavigate('invoices', 'not-paid'),
    },
    {
      id: 'overdue',
      label: 'Überfällig',
      value: formatCurrency(sumTotals(overdueInvoices), locale),
      hint: overdueInvoices.length > 0
        ? `${overdueInvoices.length} ${overdueInvoices.length === 1 ? 'Rechnung benötigt' : 'Rechnungen benötigen'} Aufmerksamkeit`
        : 'Alles im grünen Bereich',
      icon: AlertTriangle,
      accent: overdueInvoices.length > 0 ? 'text-red-600 bg-red-50' : 'text-green-600 bg-green-50',
      onClick: () => (remindersAvailable ? onNavigate('reminders') : onNavigate('invoices', 'overdue')),
    },
    {
      id: 'drafts',
      label: 'Entwürfe',
      value: String(draftCount),
      hint: 'Noch nicht versendet',
      icon: Clock,
      accent: 'text-orange-600 bg-orange-50',
      onClick: () => onNavigate('invoices', 'draft'),
    },
    {
      id: 'revenue',
      label: 'Umsatz diesen Monat',
      value: formatCurrency(currentMonthRevenue, locale),
      hint: revenueChange === null
        ? 'Kein Vergleich zum Vormonat'
        : `${revenueChange >= 0 ? '+' : ''}${revenueChange} % zum Vormonat`,
      icon: TrendingUp,
      accent: 'text-green-600 bg-green-50',
      onClick: () => onNavigate('invoices', 'all'),
    },
  ];

  const actionButtons = (invoice: Invoice) => (
    <div className="flex gap-2" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
      {invoice.status === 'draft' && (
        <button
          className="bg-primary-custom/10 hover:bg-primary-custom/20 text-primary-custom px-3 py-1 rounded-md transition-colors flex items-center text-xs font-medium"
          title="Per E-Mail versenden"
          onClick={() => handleSendEmail(invoice)}
        >
          <Send className="h-3 w-3 mr-1" />
          Versenden
        </button>
      )}
      {invoice.status !== 'draft' && invoice.status !== 'paid' && (
        <button
          className="bg-green-100 hover:bg-green-200 text-green-700 px-3 py-1 rounded-md transition-colors flex items-center text-xs font-medium"
          title="Als bezahlt markieren"
          onClick={() => handleMarkAsPaid(invoice.id)}
        >
          <Check className="h-3 w-3 mr-1" />
          Bezahlt
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-2xl lg:text-3xl font-bold text-gray-900">Dashboard</h2>
        <p className="text-gray-600 mt-1">
          {today.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          {' · '}
          {customers.length} {customers.length === 1 ? 'Kunde' : 'Kunden'}
        </p>
      </div>

      {/* Schnellaktionen */}
      <section aria-label="Schnellaktionen">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {quickActions.map((action, index) => {
            const Icon = action.icon;
            const primary = index === 0;
            return (
              <button
                key={action.id}
                onClick={action.onClick}
                className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-sm transition-all duration-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-gray-300 ${
                  primary
                    ? 'btn-primary text-white hover:brightness-90'
                    : 'bg-white border border-gray-200 text-gray-800 hover:bg-gray-50 hover:border-gray-300'
                }`}
              >
                <Plus className="h-4 w-4 flex-shrink-0" />
                <Icon className="h-4 w-4 flex-shrink-0 hidden sm:block" />
                <span className="truncate">{action.label}</span>
                {action.locked && <Lock className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />}
              </button>
            );
          })}
        </div>
      </section>

      {/* Kennzahlen */}
      <section aria-label="Kennzahlen" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map(kpi => {
          const Icon = kpi.icon;
          return (
            <button
              key={kpi.id}
              onClick={kpi.onClick}
              className="text-left bg-white rounded-xl border border-gray-100 shadow-sm p-5 hover:shadow-md hover:border-gray-200 transition-all duration-200"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-600">{kpi.label}</p>
                <span className={`p-2 rounded-lg ${kpi.accent}`}>
                  <Icon className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-2 text-2xl font-bold text-gray-900">{kpi.value}</p>
              <p className="mt-1 text-xs text-gray-500">{kpi.hint}</p>
            </button>
          );
        })}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Recent Invoices */}
        <div className="xl:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="px-4 lg:px-6 py-4 border-b border-gray-200 flex justify-between items-center gap-2">
            <h3 className="text-base lg:text-lg font-semibold text-gray-900">Aktuelle Rechnungen</h3>
            <button
              onClick={() => onNavigate('invoices', 'all')}
              className="text-sm text-primary-custom hover:text-primary-custom/80 font-medium transition-colors"
            >
              Alle anzeigen →
            </button>
          </div>

          {/* Desktop Table View */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nummer</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Kunde</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Betrag</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Datum</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Aktion</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {recentInvoices.map((invoice) => (
                  <tr
                    key={invoice.id}
                    className="hover:bg-gray-50 cursor-pointer transition-colors duration-200"
                    onClick={() => onNavigate('invoices', 'all', invoice.invoiceNumber)}
                    title={`Zur Rechnung ${invoice.invoiceNumber}`}
                  >
                    <td className="px-6 py-3 whitespace-nowrap text-sm font-medium text-primary-custom">{invoice.invoiceNumber}</td>
                    <td className="px-6 py-3 text-sm text-gray-900 max-w-[16rem] truncate">{invoice.customerName}</td>
                    <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-900 text-right tabular-nums">{formatCurrency(invoice.total, locale)}</td>
                    <td className="px-6 py-3 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(invoice.status)}`}>
                        {getStatusLabel(invoice.status)}
                      </span>
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-600">{new Date(invoice.issueDate).toLocaleDateString('de-DE')}</td>
                    <td className="px-6 py-3 whitespace-nowrap">{actionButtons(invoice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="lg:hidden">
            {recentInvoices.map((invoice) => (
              <div
                key={invoice.id}
                className="p-4 border-b border-gray-200 last:border-b-0 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => onNavigate('invoices', 'all', invoice.invoiceNumber)}
              >
                <div className="flex justify-between items-start gap-3 mb-2">
                  <div className="min-w-0">
                    <h4 className="text-sm font-medium text-primary-custom">{invoice.invoiceNumber}</h4>
                    <p className="text-sm text-gray-900 truncate">{invoice.customerName}</p>
                    <p className="text-sm font-medium text-gray-900">{formatCurrency(invoice.total, locale)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(invoice.status)}`}>
                      {getStatusLabel(invoice.status)}
                    </span>
                    <p className="text-xs text-gray-500">{new Date(invoice.issueDate).toLocaleDateString('de-DE')}</p>
                  </div>
                </div>
                {actionButtons(invoice)}
              </div>
            ))}
          </div>

          {recentInvoices.length === 0 && (
            <div className="text-center py-10 px-4">
              <p className="text-gray-500">Noch keine Rechnungen vorhanden.</p>
              <button
                onClick={() => onNavigate('invoices', 'new')}
                className="mt-3 text-sm font-medium text-primary-custom hover:text-primary-custom/80"
              >
                Erste Rechnung anlegen →
              </button>
            </div>
          )}
        </div>

        {/* Überfällige Rechnungen */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="px-4 lg:px-6 py-4 border-b border-gray-200 flex justify-between items-center gap-2">
            <h3 className="text-base lg:text-lg font-semibold text-gray-900">Überfällige Rechnungen</h3>
            {overdueInvoices.length > 0 && (
              <button
                onClick={() => (remindersAvailable ? onNavigate('reminders') : onNavigate('invoices', 'overdue'))}
                className="text-sm text-primary-custom hover:text-primary-custom/80 font-medium transition-colors"
              >
                {remindersAvailable ? 'Mahnwesen →' : 'Alle →'}
              </button>
            )}
          </div>
          {overdueInvoices.length === 0 ? (
            <div className="flex flex-col items-center text-center py-10 px-4">
              <CheckCircle className="h-8 w-8 text-green-500" />
              <p className="mt-2 text-sm text-gray-600">Keine überfälligen Rechnungen.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {overdueInvoices.slice(0, 5).map(invoice => {
                const daysOverdue = Math.max(0, Math.floor((today.getTime() - new Date(invoice.dueDate).setHours(0, 0, 0, 0)) / DAY_MS));
                return (
                  <li
                    key={invoice.id}
                    className="px-4 lg:px-6 py-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => onNavigate('invoices', 'all', invoice.invoiceNumber)}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{invoice.customerName}</p>
                      <p className="text-xs text-gray-500">
                        {invoice.invoiceNumber} · <span className="text-red-600">{daysOverdue} {daysOverdue === 1 ? 'Tag' : 'Tage'} überfällig</span>
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-sm font-semibold text-gray-900 tabular-nums">{formatCurrency(invoice.total, locale)}</span>
                      {actionButtons(invoice)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Umsatz der letzten 6 Monate */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-4 lg:px-6 py-4 border-b border-gray-200 flex justify-between items-center gap-2">
          <h3 className="text-base lg:text-lg font-semibold text-gray-900">Umsatz der letzten 6 Monate</h3>
          {company.reportingEnabled && (
            <button
              onClick={() => onNavigate('reporting')}
              className="text-sm text-primary-custom hover:text-primary-custom/80 font-medium transition-colors"
            >
              Reporting →
            </button>
          )}
        </div>
        <ul className="px-4 lg:px-6 py-4 space-y-3">
          {monthlyRevenue.map(({ month, revenue }) => (
            <li key={month.toISOString()} className="grid grid-cols-[5.5rem_1fr_auto] sm:grid-cols-[7rem_1fr_8rem] items-center gap-3">
              <span className="text-sm text-gray-600">{month.toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })}</span>
              <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary-custom"
                  style={{ width: maxMonthlyRevenue > 0 ? `${(revenue / maxMonthlyRevenue) * 100}%` : '0%' }}
                />
              </div>
              <span className="text-sm font-medium text-gray-900 text-right tabular-nums">{formatCurrency(revenue, locale)}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Email Send Modal */}
      <EmailSendModal
        isOpen={emailModal.isOpen}
        onClose={handleEmailModalClose}
        onSend={handleEmailSend}
        document={emailModal.invoice!}
        documentType="invoice"
        customer={emailModal.customer!}
        isLoading={isSendingEmail === emailModal.invoice?.id}
      />
    </div>
  );
}