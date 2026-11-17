import React, { useState, useEffect } from 'react';
import logger from '../utils/logger';
import { mergeAttachmentContent, invoiceNeedsContent } from '../utils/attachmentContent';
import { apiService } from '../services/api';
import { Save, Plus, Trash2, Edit } from 'lucide-react';
import { arrayMove } from '@dnd-kit/sortable';
import { useInvoices } from '../context/InvoiceContext';
import { DocumentChain } from './DocumentChain';
import { useCustomers } from '../context/CustomerContext';
import { useCompany } from '../context/CompanyContext';
import { useDocumentHelpers } from '../hooks/useDocumentHelpers';
import { Invoice, InvoiceItem, InvoiceAttachment, InvoiceTemplate } from '../types';
import { AttachmentManager } from './AttachmentManager';
import { calculateInvoiceWithDiscounts, updateItemWithDiscount } from '../utils/discountUtils';
import { DocumentPreview, PreviewDocument } from './DocumentPreview';
import { RatesAndMaterialsRedirectModal } from './RatesAndMaterialsRedirectModal';
import { CustomerCreateModal } from './CustomerCreateModal';
import { PageShell } from './PageShell';
import { Modal } from './Modal';
import { generateUUID } from '../utils/uuid';
import { LineItemList } from './LineItemList';
import { FormSection, CustomerPicker, TemplateAddBar, GlobalDiscountSection, DocumentTotals, fieldInputClass, fieldLabelClass } from './DocumentFormParts';

interface InvoiceEditorProps {
  invoice?: Invoice | null;
  onClose: () => void;
  onNavigateToCustomers?: () => void;
  onNavigateToSettings?: () => void;
}

export function InvoiceEditor({ invoice, onClose, onNavigateToCustomers, onNavigateToSettings }: InvoiceEditorProps) {
  const { customers } = useCustomers();
  const { addInvoice, updateInvoice, refreshInvoices } = useInvoices();
  const {
    company,
    getInvoiceTemplates,
    addInvoiceTemplate,
    deleteInvoiceTemplate,
  } = useCompany();
  const {
    getCombinedHourlyRatesForCustomer,
    getCombinedMaterialTemplatesForCustomer,
  } = useDocumentHelpers();
  const discountsEnabled = company.discountsEnabled !== false;
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [showInvoiceTemplateForm, setShowInvoiceTemplateForm] = useState(false);
  const [showInvoiceTemplateManager, setShowInvoiceTemplateManager] = useState(false);
  const [showRatesRedirectModal, setShowRatesRedirectModal] = useState<{
    isOpen: boolean;
    type: 'hourlyRates' | 'materials';
  }>({
    isOpen: false,
    type: 'hourlyRates'
  });
  const [, setEditingInvoiceTemplate] = useState<InvoiceTemplate | null>(null);
  const [newInvoiceTemplateData, setNewInvoiceTemplateData] = useState({
    name: '',
    description: '',
    unitPrice: 0,
    unit: 'Stunde',
    taxRate: 19,
    isDefault: false
  });

  
  // We'll define these helper functions after formData is available
  
  // Berechne das Standard-Fälligkeitsdatum basierend auf Rechnungsdatum und Unternehmenseinstellungen
  const calculateDueDate = (issueDate: string) => {
    // Überprüfung ob das Datum gültig ist
    if (!issueDate || issueDate.length < 10) {
      // Fallback zu heutigem Datum wenn ungültig
      const fallbackDate = new Date();
      const paymentDays = company.defaultPaymentDays !== undefined ? company.defaultPaymentDays : 30;
      const dueDateObj = new Date(fallbackDate.getTime() + paymentDays * 24 * 60 * 60 * 1000);
      return dueDateObj.toISOString().split('T')[0];
    }
    
    const paymentDays = company.defaultPaymentDays !== undefined ? company.defaultPaymentDays : 30;
    const issueDateObj = new Date(issueDate);
    
    // Überprüfung ob das Datum korrekt geparst wurde
    if (isNaN(issueDateObj.getTime())) {
      // Fallback zu heutigem Datum wenn ungültig
      const fallbackDate = new Date();
      const dueDateObj = new Date(fallbackDate.getTime() + paymentDays * 24 * 60 * 60 * 1000);
      return dueDateObj.toISOString().split('T')[0];
    }
    
    // Bei 0 Tagen ist das Fälligkeitsdatum das Rechnungsdatum selbst
    const dueDateObj = new Date(issueDateObj.getTime() + paymentDays * 24 * 60 * 60 * 1000);
    return dueDateObj.toISOString().split('T')[0];
  };
  
  const [formData, setFormData] = useState({
    invoiceNumber: '',
    customerId: '',
    issueDate: new Date().toISOString().split('T')[0],
    dueDate: calculateDueDate(new Date().toISOString().split('T')[0]),
    status: 'draft' as Invoice['status'],
    notes: '',
    globalDiscountType: undefined as 'percentage' | 'fixed' | undefined,
    globalDiscountValue: undefined as number | undefined,
    globalDiscountAmount: undefined as number | undefined,
  });
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [attachments, setAttachments] = useState<InvoiceAttachment[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  // Initialize form data when editing
  useEffect(() => {
    if (invoice) {
      setFormData({
        invoiceNumber: invoice.invoiceNumber,
        customerId: invoice.customerId,
        issueDate: new Date(invoice.issueDate).toISOString().split('T')[0],
        dueDate: new Date(invoice.dueDate).toISOString().split('T')[0],
        status: invoice.status,
        notes: invoice.notes || '',
        globalDiscountType: invoice.globalDiscountType,
        globalDiscountValue: invoice.globalDiscountValue,
        globalDiscountAmount: invoice.globalDiscountAmount,
      });
      // Sort items by order and ensure all items have an order value
      const sortedItems = [...invoice.items]
        .sort((a, b) => (a.order || 999) - (b.order || 999))
        .map((item, index) => ({
          ...item,
          order: item.order || index + 1,  // Fallback to index-based order for existing items
          // Bei Kleinunternehmerregelung immer MwSt. auf 0 normalisieren
          taxRate: company?.isSmallBusiness ? 0 : item.taxRate
        }));
      setItems(sortedItems);
      setAttachments(invoice.attachments || []);
    } else {
      // For new invoices, leave invoice number empty - it will be generated by the backend
      setFormData(prev => ({ ...prev, invoiceNumber: '' }));
    }
  // Nur bei Wechsel der Rechnung initialisieren; Firmen-Updates dürfen das Formular nicht zurücksetzen.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice]);

  // Listen liefern Anhänge ohne Inhalt: für Vorschau/Download nachladen.
  useEffect(() => {
    if (!invoice || !invoiceNeedsContent(invoice)) return;
    let cancelled = false;
    apiService.getInvoice(invoice.id)
      .then(full => {
        if (!cancelled) setAttachments(prev => mergeAttachmentContent(prev, full.attachments || []));
      })
      .catch(error => logger.error('Fehler beim Laden der Anhänge:', error));
    return () => { cancelled = true; };
  }, [invoice]);

  const addItem = () => {
    const newItem: InvoiceItem = {
      id: generateUUID(),
      description: '',
      quantity: 1,
      unitPrice: 0,
      taxRate: company?.isSmallBusiness ? 0 : 19,
      total: 0,
      order: items.length + 1,
      discountType: undefined,
      discountValue: undefined,
      discountAmount: 0,
    };
    setItems(prev => [...prev, newItem]);
  };

  const addItemFromTemplate = (templateType: 'invoice' | 'material' | 'hourly', templateId: string) => {
    let newItem: InvoiceItem;

    if (templateType === 'invoice') {
      const template = getInvoiceTemplates().find(t => t.id === templateId);
      if (!template) return;
      
      newItem = {
        id: generateUUID(),
        description: template.name,
        quantity: 1,
        unitPrice: parseFloat(template.unitPrice || 0),
        taxRate: company?.isSmallBusiness ? 0 : template.taxRate,
        total: parseFloat(template.unitPrice || 0) * 1,
        order: items.length + 1,
        discountType: undefined,
        discountValue: undefined,
        discountAmount: 0,
      };
    } else if (templateType === 'material') {
      // Search in combined templates (both general and customer-specific)
      const template = getCombinedMaterialTemplatesForCustomer(formData.customerId).find(t => t.id === templateId);
      if (!template) return;
      
      newItem = {
        id: generateUUID(),
        description: template.name,
        quantity: 1,
        unitPrice: parseFloat(template.unitPrice || 0),
        taxRate: company?.isSmallBusiness ? 0 : (template.taxRate != null ? template.taxRate : 19),
        total: parseFloat(template.unitPrice || 0) * 1,
        order: items.length + 1,
        discountType: undefined,
        discountValue: undefined,
        discountAmount: 0,
      };
    } else { // hourly
      // Search in combined templates (both general and customer-specific)
      const template = getCombinedHourlyRatesForCustomer(formData.customerId).find(t => t.id === templateId);
      if (!template) return;
      
      newItem = {
        id: generateUUID(),
        description: template.name,
        quantity: 1,
        unitPrice: parseFloat(template.rate || 0),
        taxRate: company?.isSmallBusiness ? 0 : (template.taxRate != null ? template.taxRate : 19),
        total: parseFloat(template.rate || 0) * 1,
        order: items.length + 1,
        discountType: undefined,
        discountValue: undefined,
        discountAmount: 0,
      };
    }

    setItems(prev => [...prev, newItem]);
  };

  const updateItem = (id: string, field: keyof InvoiceItem, value: string | number | undefined) => {
    setItems(prev => prev.map(item => {
      if (item.id === id) {
        const updated = { ...item, [field]: value };
        // Bei Kleinunternehmerregelung immer MwSt. auf 0 setzen
        if (company?.isSmallBusiness && field === 'taxRate') {
          updated.taxRate = 0;
        }
        
        // Berechne Rabatte und Gesamtsumme neu bei relevanten Änderungen
        if (field === 'quantity' || field === 'unitPrice' || field === 'taxRate' || 
            field === 'discountType' || field === 'discountValue') {
          const updatedWithDiscount = updateItemWithDiscount(updated);
          return updatedWithDiscount;
        }
        
        return updated;
      }
      return item;
    }));
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  const reorderItems = (fromIndex: number, toIndex: number) => {
    setItems(prev => arrayMove(prev, fromIndex, toIndex).map((item, i) => ({ ...item, order: i + 1 })));
  };

  const calculateTotals = () => {
    return calculateInvoiceWithDiscounts(
      items,
      { type: formData.globalDiscountType, value: formData.globalDiscountValue },
      company?.isSmallBusiness
    );
  };

  const handlePreview = (attachments: (InvoiceAttachment)[], initialIndex: number) => {
    // Convert attachments to preview documents
    const documents: PreviewDocument[] = attachments.map(attachment => ({
      id: attachment.id,
      name: attachment.name,
      type: 'attachment' as const,
      content: attachment.content,
      contentType: attachment.contentType,
      size: attachment.size
    }));
    
    setDocumentPreview({
      isOpen: true,
      documents,
      initialIndex
    });
  };

  const handleClosePreview = () => {
    setDocumentPreview({
      isOpen: false,
      documents: [],
      initialIndex: 0
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (items.length === 0) {
      alert('Bitte fügen Sie mindestens eine Position hinzu.');
      return;
    }

    const customer = customers.find(c => c.id === formData.customerId);
    if (!customer) {
      alert('Bitte wählen Sie einen Kunden aus.');
      return;
    }

    setIsSubmitting(true);

    const calculation = calculateTotals();
    // Bei Kleinunternehmerregelung MwSt. auch in den gespeicherten Positionen auf 0 normalisieren
    const itemsToSave = company?.isSmallBusiness
      ? items.map(item => ({ ...item, taxRate: 0 }))
      : items;

    const invoiceData: Omit<Invoice, 'id' | 'createdAt'> = {
      invoiceNumber: invoice ? formData.invoiceNumber : '', // Keep existing number for updates, empty for new invoices
      customerId: formData.customerId,
      customerName: customer.name,
      issueDate: new Date(formData.issueDate),
      dueDate: new Date(formData.dueDate),
      items: itemsToSave,
      subtotal: calculation.subtotal,
      taxAmount: calculation.taxAmount,
      total: calculation.total,
      status: formData.status,
      notes: formData.notes,
      attachments,
      globalDiscountType: formData.globalDiscountType,
      globalDiscountValue: formData.globalDiscountValue,
      globalDiscountAmount: calculation.globalDiscountAmount,
    };

    try {
      if (invoice) {
        await updateInvoice(invoice.id, invoiceData);
        // Refresh invoices in other components
        await refreshInvoices();
      } else {
        await addInvoice(invoiceData);
        // Refresh invoices in other components
        await refreshInvoices();
      }
      onClose();
    } catch (error) {
      logger.error('Failed to save invoice', { error: (error as Error).message });
      alert('Fehler beim Speichern der Rechnung. Bitte versuchen Sie es erneut.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const totals = calculateTotals();

  return (
    <div>
      <PageShell
        title={invoice ? 'Rechnung bearbeiten' : 'Neue Rechnung'}
        subtitle={invoice ? `${invoice.invoiceNumber}` : 'Erstellen Sie eine neue Rechnung'}
        onClose={onClose}
        header={invoice ? <DocumentChain kind="invoice" id={invoice.id} /> : undefined}
        footer={
          <>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              form="invoice-form"
              disabled={isSubmitting}
              className="px-6 py-2 btn-primary rounded-lg transition-colors flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="h-4 w-4" />
              <span>{isSubmitting ? 'Wird gespeichert...' : (invoice ? 'Aktualisieren' : 'Erstellen')}</span>
            </button>
          </>
        }
      >
      <form id="invoice-form" onSubmit={handleSubmit} className="space-y-6">
        <FormSection title="Grundinformationen">
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className={fieldLabelClass}>
                Rechnungsnummer
              </label>
              <input
                type="text"
                value={formData.invoiceNumber}
                placeholder={invoice ? "" : "Wird automatisch generiert"}
                disabled={true}
                readOnly={true}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed"
              />
              <p className="text-xs text-gray-500 mt-1">
                {invoice ? "Rechnungsnummern können nach der Erstellung nicht mehr geändert werden" : "Die Rechnungsnummer wird beim Speichern automatisch generiert (Format: RE-YYYY-XXX)"}
              </p>
            </div>
            <CustomerPicker
              customers={customers}
              selectedId={formData.customerId}
              onSelect={(c) => setFormData(prev => ({ ...prev, customerId: c?.id || '' }))}
              onCreateNew={() => setShowCustomerForm(true)}
            />
            <div>
              <label className={fieldLabelClass}>
                Rechnungsdatum *
              </label>
              <input
                type="date"
                required
                value={formData.issueDate}
                onChange={(e) => {
                  const newIssueDate = e.target.value;
                  try {
                    setFormData(prev => ({ 
                      ...prev, 
                      issueDate: newIssueDate,
                      dueDate: calculateDueDate(newIssueDate)
                    }));
                  } catch (error) {
                    logger.warn('Error calculating due date', { error: (error as Error).message });
                    // Nur das Issue Date aktualisieren wenn Berechnung fehlschlägt
                    setFormData(prev => ({ 
                      ...prev, 
                      issueDate: newIssueDate
                    }));
                  }
                }}
                className={fieldInputClass}
              />
            </div>
            <div>
              <label className={fieldLabelClass}>
                Fälligkeitsdatum *
              </label>
              <input
                type="date"
                required
                value={formData.dueDate}
                onChange={(e) => setFormData(prev => ({ ...prev, dueDate: e.target.value }))}
                className={fieldInputClass}
              />
              <p className="text-xs text-gray-500 mt-1">
                Wird automatisch auf {company.defaultPaymentDays !== undefined ? company.defaultPaymentDays : 30} Tage nach Rechnungsdatum gesetzt. {(company.defaultPaymentDays !== undefined ? company.defaultPaymentDays : 30) === 0 && 'Bei 0 Tagen ist die Rechnung sofort fällig.'}
              </p>
            </div>
          </div>
        </FormSection>

        <FormSection title="Positionen">
          <TemplateAddBar
            groups={[
              {
                label: 'Eigene Positionen',
                options: getInvoiceTemplates().map(template => ({
                  value: `invoice:${template.id}`,
                  label: `${template.name} - ${(Number(template.unitPrice) || 0).toFixed(2)}€/${template.unit}`,
                })),
              },
              {
                label: 'Stundensätze',
                options: getCombinedHourlyRatesForCustomer(formData.customerId).map(rate => ({
                  value: `hourly:${rate.id}`,
                  label: `${rate.displayName} - ${(Number(rate.rate) || 0).toFixed(2)}€/h`,
                })),
              },
              {
                label: 'Materialien',
                options: getCombinedMaterialTemplatesForCustomer(formData.customerId).map(material => ({
                  value: `material:${material.id}`,
                  label: `${material.displayName} - ${(Number(material.unitPrice) || 0).toFixed(2)}€/${material.unit}`,
                })),
              },
            ]}
            onSelect={(value) => {
              const [templateType, templateId] = value.split(':');
              addItemFromTemplate(templateType as 'invoice' | 'material' | 'hourly', templateId);
            }}
            onManage={() => setShowRatesRedirectModal({ isOpen: true, type: 'materials' })}
            onAddManual={addItem}
          />
          <LineItemList
            items={items}
            onUpdate={updateItem}
            onRemove={removeItem}
            onReorder={reorderItems}
            isSmallBusiness={company?.isSmallBusiness || false}
            discountsEnabled={discountsEnabled}
          />
        </FormSection>

        {items.length > 0 && discountsEnabled && (
          <GlobalDiscountSection
            type={formData.globalDiscountType}
            value={formData.globalDiscountValue}
            amount={totals.globalDiscountAmount}
            onChange={({ type, value }) => setFormData(prev => ({ ...prev, globalDiscountType: type, globalDiscountValue: value }))}
          />
        )}

        {items.length > 0 && (
          <DocumentTotals
            totals={totals}
            discountsEnabled={discountsEnabled}
            isSmallBusiness={company?.isSmallBusiness || false}
          />
        )}

        <FormSection title="Notizen">
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
            rows={4}
            placeholder="Zusätzliche Informationen oder Zahlungshinweise..."
            className={`${fieldInputClass} resize-none`}
          />
        </FormSection>

        <FormSection title="Anhänge">
          <AttachmentManager
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            allowUpload={true}
            allowPreview={true}
            onPreview={handlePreview}
          />
        </FormSection>
      </form>
      </PageShell>

      {showCustomerForm && (
        <CustomerCreateModal
          onClose={() => setShowCustomerForm(false)}
          onCreated={(c) => setFormData(prev => ({ ...prev, customerId: c.id }))}
        />
      )}

      {/* Invoice Template Form Modal */}
      {showInvoiceTemplateForm && (
        <Modal
          title="Neue Rechnungsvorlage erstellen"
          zClass="z-[60]"
          onClose={() => {
            setNewInvoiceTemplateData({
                      name: '',
                      description: '',
                      unitPrice: 0,
                      unit: 'Stunde',
                      taxRate: 19,
                      isDefault: false
                    });
                    setShowInvoiceTemplateForm(false);
          }}
          footer={
            <>
              <button
                type="button"
                onClick={() => {
                  setNewInvoiceTemplateData({
                      name: '',
                      description: '',
                      unitPrice: 0,
                      unit: 'Stunde',
                      taxRate: 19,
                      isDefault: false
                    });
                    setShowInvoiceTemplateForm(false);
                }}
                className="bg-gray-300 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-400 transition-colors"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                form="invoice-template-form"
                className="bg-primary-custom text-white py-2 px-4 rounded-lg hover:bg-primary-custom/90 transition-colors"
              >
                Vorlage erstellen
              </button>
            </>
          }
        >
            <form id="invoice-template-form" onSubmit={async (e) => {
              e.preventDefault();
              
              if (!newInvoiceTemplateData.name || newInvoiceTemplateData.unitPrice <= 0) {
                alert('Bitte geben Sie mindestens einen Namen und einen gültigen Preis ein.');
                return;
              }

              // Check for duplicate names
              const templates = getInvoiceTemplates() || [];
              const existingTemplate = templates.find((t) => 
                t.name.toLowerCase().replace(/\s+/g, '') === newInvoiceTemplateData.name.toLowerCase().replace(/\s+/g, '')
              );

              if (existingTemplate) {
                alert(`Eine Rechnungsvorlage mit dem Namen "${newInvoiceTemplateData.name}" existiert bereits. Bitte wählen Sie einen anderen Namen.`);
                return;
              }

              try {
                await addInvoiceTemplate(newInvoiceTemplateData);
                
                // Reset form
                setNewInvoiceTemplateData({
                  name: '',
                  description: '',
                  unitPrice: 0,
                  unit: 'Stunde',
                  taxRate: 19,
                  isDefault: false
                });
                setShowInvoiceTemplateForm(false);
              } catch (error) {
                console.error('Error creating invoice template:', error);
                alert('Fehler beim Erstellen der Rechnungsvorlage. Bitte versuchen Sie es erneut.');
              }
            }} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={newInvoiceTemplateData.name}
                  onChange={(e) => setNewInvoiceTemplateData({ ...newInvoiceTemplateData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                  placeholder="z.B. Beratung, Analyse, Konzeption..."
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Beschreibung
                </label>
                <textarea
                  value={newInvoiceTemplateData.description}
                  onChange={(e) => setNewInvoiceTemplateData({ ...newInvoiceTemplateData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                  placeholder="Optionale Beschreibung..."
                  rows={2}
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Preis (€) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newInvoiceTemplateData.unitPrice}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === '' || !isNaN(parseFloat(value))) {
                        setNewInvoiceTemplateData({ ...newInvoiceTemplateData, unitPrice: value === '' ? 0 : parseFloat(value) || 0 });
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                    placeholder="0.00"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Einheit *
                  </label>
                  <input
                    type="text"
                    value={newInvoiceTemplateData.unit}
                    onChange={(e) => setNewInvoiceTemplateData({ ...newInvoiceTemplateData, unit: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                    placeholder="z.B. Stunde, Tag, Projekt..."
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  MwSt.-Satz (%) *
                </label>
                <select
                  value={newInvoiceTemplateData.taxRate}
                  onChange={(e) => setNewInvoiceTemplateData({ ...newInvoiceTemplateData, taxRate: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                  required
                >
                  <option value={0}>0% (Steuerbefreit)</option>
                  <option value={7}>7% (Ermäßigter Satz)</option>
                  <option value={19}>19% (Standard-Satz)</option>
                </select>
              </div>
              
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="invoiceTemplateDefault"
                  checked={newInvoiceTemplateData.isDefault}
                  onChange={(e) => setNewInvoiceTemplateData({ ...newInvoiceTemplateData, isDefault: e.target.checked })}
                  className="h-4 w-4 text-primary-custom border-gray-300 focus:ring-primary-custom rounded"
                />
                <label htmlFor="invoiceTemplateDefault" className="ml-2 text-sm text-gray-700">
                  Als Standard-Vorlage markieren
                </label>
              </div>
            </form>
        </Modal>
      )}

      {/* Invoice Template Manager Modal */}
      {showInvoiceTemplateManager && (
        <Modal title="Rechnungsvorlagen verwalten" size="xl" zClass="z-50" onClose={() => setShowInvoiceTemplateManager(false)}>
            <div>
              <div className="mb-4">
                <button
                  onClick={() => setShowInvoiceTemplateForm(true)}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center space-x-2 hover:bg-blue-700 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  <span>Neue Vorlage erstellen</span>
                </button>
              </div>
              
              <div className="grid gap-4">
                {getInvoiceTemplates().map((template) => (
                  <div key={template.id} className="border border-gray-200 rounded-lg p-4 flex justify-between items-center">
                    <div>
                      <h4 className="font-medium text-gray-900">{template.name}</h4>
                      <p className="text-sm text-gray-600">{template.description}</p>
                      <p className="text-sm text-gray-500">
                        {parseFloat(String(template.unitPrice || 0)).toFixed(2)}€/{template.unit} • {template.taxRate}% MwSt.
                        {template.isDefault && <span className="ml-2 bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs">Standard</span>}
                      </p>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => setEditingInvoiceTemplate(template)}
                        className="text-blue-600 hover:text-blue-800 p-2 rounded-lg hover:bg-blue-50 transition-colors"
                        title="Bearbeiten"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={async () => {
                          if (confirm(`Möchten Sie die Vorlage "${template.name}" wirklich löschen?`)) {
                            try {
                              await deleteInvoiceTemplate(template.id);
                            } catch (error) {
                              console.error('Error deleting template:', error);
                              alert('Fehler beim Löschen der Vorlage.');
                            }
                          }
                        }}
                        className="text-red-600 hover:text-red-800 p-2 rounded-lg hover:bg-red-50 transition-colors"
                        title="Löschen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
                
                {getInvoiceTemplates().length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <p>Noch keine Rechnungsvorlagen erstellt.</p>
                    <p>Klicken Sie auf "Neue Vorlage erstellen" um zu beginnen.</p>
                  </div>
                )}
              </div>
            </div>
        </Modal>
      )}

      {/* Document Preview Modal */}
      <DocumentPreview
        isOpen={documentPreview.isOpen}
        onClose={handleClosePreview}
        documents={documentPreview.documents}
        initialIndex={documentPreview.initialIndex}
      />

      {/* Rates and Materials Redirect Modal */}
      <RatesAndMaterialsRedirectModal
        isOpen={showRatesRedirectModal.isOpen}
        onClose={() => setShowRatesRedirectModal({ isOpen: false, type: 'hourlyRates' })}
        onNavigateToCustomers={() => onNavigateToCustomers && onNavigateToCustomers()}
        onNavigateToSettings={() => onNavigateToSettings && onNavigateToSettings()}
        type={showRatesRedirectModal.type}
      />
    </div>
  );
}