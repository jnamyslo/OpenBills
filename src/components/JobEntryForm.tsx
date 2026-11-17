import React, { useState, useEffect } from 'react';
import logger from '../utils/logger';
import { mergeAttachmentContent, jobNeedsContent } from '../utils/attachmentContent';
import { apiService } from '../services/api';
import { Save, PenTool } from 'lucide-react';
import { arrayMove } from '@dnd-kit/sortable';
import { JobEntry, Customer, JobMaterial, JobAttachment, JobTimeEntry, JobSignature } from '../types';
import { useCompany } from '../context/CompanyContext';
import { DocumentChain } from './DocumentChain';
import { useDocumentHelpers } from '../hooks/useDocumentHelpers';
import { AttachmentManager } from './AttachmentManager';
import { DocumentPreview, PreviewDocument } from './DocumentPreview';
import { SignaturePad } from './SignaturePad';
import { RatesAndMaterialsRedirectModal } from './RatesAndMaterialsRedirectModal';
import { createDefaultTimeEntry } from '../utils/jobUtils';
import { generateUUID } from '../utils/uuid';
import { CustomerCreateModal } from './CustomerCreateModal';
import { PageShell } from './PageShell';
import { calculateInvoiceWithDiscounts, calculateItemDiscount } from '../utils/discountUtils';
import { buildInvoiceItemsFromJobs } from '../utils/jobInvoiceItems';
import { LineItem, LineItemList } from './LineItemList';
import { FormSection, CustomerPicker, TemplateAddBar, GlobalDiscountSection, DocumentTotals, fieldInputClass, fieldLabelClass } from './DocumentFormParts';

interface JobEntryFormProps {
  job?: JobEntry | null;
  customers: Customer[];
  defaultDate?: Date | null;
  /** Vorbelegung für neue Aufträge (z. B. aus dem Kalender-Schnell-Overlay). */
  initialValues?: Partial<Pick<JobEntry, 'customerId' | 'customerName' | 'customerAddress' | 'title' | 'description'>>;
  onSubmit: (jobData: Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onCancel: () => void;
  onNavigateToCustomers?: () => void;
  onNavigateToSettings?: () => void;
}

export function JobEntryForm({ job, customers, defaultDate, initialValues, onSubmit, onCancel, onNavigateToCustomers, onNavigateToSettings }: JobEntryFormProps) {
    const { company, getHourlyRates } = useCompany();

  const { getHourlyRatesForCustomer, getCombinedHourlyRatesForCustomer, getCombinedMaterialTemplatesForCustomer } = useDocumentHelpers();


  const [showCustomerForm, setShowCustomerForm] = useState(false);

  const [showRatesRedirectModal, setShowRatesRedirectModal] = useState<{
    isOpen: boolean;
    type: 'hourlyRates' | 'materials';
  }>({
    isOpen: false,
    type: 'hourlyRates'
  });


  
  // We'll define these helper functions after formData is available
  

  
  // Signature Pad state
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  
  const [formData, setFormData] = useState<Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'>>({
    jobNumber: '', // Will be auto-generated
    externalJobNumber: '',
    customerId: '',
    customerName: '',
    customerAddress: '',
    title: '',
    description: '',
    date: new Date(),
    startTime: '',
    endTime: '',
    hoursWorked: 0,
    hourlyRate: 0,
    hourlyRateId: '',
    timeEntries: [],
    materials: [],
    status: 'draft', // Standard-Status ist "Entwurf"
    notes: '',
    attachments: [],
    signature: undefined
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

  useEffect(() => {
    if (job) {
      setFormData({
        jobNumber: job.jobNumber,
        externalJobNumber: job.externalJobNumber || '',
        customerId: job.customerId,
        customerName: job.customerName,
        customerAddress: job.customerAddress || '',
        title: job.title,
        description: job.description,
        date: typeof job.date === 'string' ? new Date(job.date) : job.date,
        startTime: job.startTime || '',
        endTime: job.endTime || '',
        hoursWorked: job.hoursWorked,
        hourlyRate: job.hourlyRate,
        hourlyRateId: job.hourlyRateId || '',
        timeEntries: job.timeEntries || [],
        materials: job.materials || [],
        status: job.status,
        notes: job.notes || '',
        attachments: job.attachments || [],
        signature: job.signature || undefined,
        globalDiscountType: job.globalDiscountType,
        globalDiscountValue: job.globalDiscountValue
      });
    } else {
      // Für neue Aufträge: keine Standard-Zeiteinträge, Nutzer muss explizit hinzufügen
      // Note: For new jobs, we can't use customer-specific rates yet since customer isn't selected
      const defaultRate = getHourlyRates().find((rate) => rate.isDefault);
      const initialFormData: Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'> = {
        jobNumber: '', // Will be auto-generated
        externalJobNumber: '',
        customerId: '',
        customerName: '',
        customerAddress: '',
        title: '',
        description: '',
        date: defaultDate || new Date(), // Use defaultDate if provided
        startTime: '',
        endTime: '',
        hoursWorked: 0,
        hourlyRate: 0,
        hourlyRateId: '',
        timeEntries: [],
        materials: [],
        status: 'draft', // Standard-Status ist "Entwurf"
        notes: '',
        attachments: [],
        signature: undefined,
        ...initialValues
      };
      
      if (defaultRate) {
        initialFormData.hourlyRateId = defaultRate.id;
        initialFormData.hourlyRate = defaultRate.rate;
      }
      
      setFormData(initialFormData);
    }
    // Intentionally keyed on `job?.id` only: a changing `company.hourlyRates`
    // reference (settings updated elsewhere) or a fresh `defaultDate` identity
    // must NOT reset an in-progress form (same class as QuoteEditor's init effect fix).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  // Liste liefert Anhänge ohne Inhalt: für Vorschau/Download nachladen.
  useEffect(() => {
    if (!job || !jobNeedsContent(job)) return;
    let cancelled = false;
    apiService.getJobEntry(job.id)
      .then(full => {
        if (!cancelled) {
          setFormData(prev => ({
            ...prev,
            attachments: mergeAttachmentContent(prev.attachments || [], full.attachments || [])
          }));
        }
      })
      .catch(error => logger.error('Fehler beim Laden der Anhänge:', error));
    return () => { cancelled = true; };
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCustomerSelect = (customer: Customer | null) => {
    setFormData(prev => ({
      ...prev,
      customerId: customer?.id || '',
      customerName: customer?.name || ''
    }));
  };

  const addTimeEntry = () => {
    const availableRates = getHourlyRatesForCustomer(formData.customerId);
    const defaultRate = availableRates.find((rate) => rate.isDefault);
    const newTimeEntry = createDefaultTimeEntry(
      defaultRate ? defaultRate.rate : 0,
      defaultRate ? defaultRate.id : '',
      defaultRate?.taxRate != null ? defaultRate.taxRate : 19 // Use hourly rate tax rate or default to 19%
    );
    
    setFormData((prev) => ({
      ...prev,
      timeEntries: [...(prev.timeEntries || []), newTimeEntry]
    }));
  };

  const addTimeEntryFromTemplate = (hourlyRateId: string) => {
    // Search in combined templates (both general and customer-specific)
    const template = getCombinedHourlyRatesForCustomer(formData.customerId).find((rate) => rate.id === hourlyRateId);
    if (!template) return;
    
    const newTimeEntry = createDefaultTimeEntry(
      parseFloat(String(template.rate || 0)),
      template.id,
      template.taxRate != null ? template.taxRate : 19
    );
    
    // Set description to template name
    newTimeEntry.description = template.name;
    
    setFormData((prev) => ({
      ...prev,
      timeEntries: [...(prev.timeEntries || []), newTimeEntry]
    }));
  };

  // Positionsrabatt auf Betrag und Summe anwenden (wie bei Rechnungspositionen)
  const withDiscount = <T extends { discountType?: 'percentage' | 'fixed'; discountValue?: number }>(entry: T, quantity: number, unitPrice: number) => {
    const discountAmount = calculateItemDiscount(quantity, unitPrice, entry.discountType, entry.discountValue);
    return { ...entry, discountAmount, total: quantity * unitPrice - discountAmount };
  };

  const totalHoursOf = (timeEntries: JobTimeEntry[]) =>
    timeEntries.reduce((sum, entry) => sum + (parseFloat(String(entry.hoursWorked)) || 0), 0);

  const timeEntryFields: Record<string, keyof JobTimeEntry> = { quantity: 'hoursWorked', unitPrice: 'hourlyRate' };

  const updateTimeEntry = (id: string, field: string, value: string | number | undefined) => {
    setFormData((prev) => {
      const timeEntries = (prev.timeEntries || []).map(entry => {
        if (entry.id !== id) return entry;
        const updated = { ...entry, [timeEntryFields[field] || field]: value };
        return withDiscount(updated, parseFloat(String(updated.hoursWorked)) || 0, parseFloat(String(updated.hourlyRate)) || 0);
      });
      // Gesamtstunden am Auftrag für Abwärtskompatibilität
      return { ...prev, timeEntries, hoursWorked: totalHoursOf(timeEntries) };
    });
  };

  const removeTimeEntry = (id: string) => {
    setFormData((prev) => {
      const timeEntries = (prev.timeEntries || []).filter(entry => entry.id !== id);
      return { ...prev, timeEntries, hoursWorked: totalHoursOf(timeEntries) };
    });
  };

  const reorderTimeEntries = (fromIndex: number, toIndex: number) => {
    setFormData(prev => ({ ...prev, timeEntries: arrayMove(prev.timeEntries || [], fromIndex, toIndex) }));
  };


  const addMaterial = (templateId?: string) => {
    let newMaterial: JobMaterial;
    
    if (templateId) {
      // Use template data - safely handle potential errors
      try {
        const templates = getCombinedMaterialTemplatesForCustomer(formData.customerId) || [];
        const template = templates.find((t) => t.id === templateId);
        
        if (template) {
          // Ensure unitPrice is a number - handle both string and number formats
          const unitPrice = typeof template.unitPrice === 'string' 
            ? parseFloat(template.unitPrice) 
            : Number(template.unitPrice) || 0;
          
          newMaterial = {
            id: generateUUID(),
            description: template.name,
            quantity: 1,
            unitPrice: unitPrice,
            taxRate: company?.isSmallBusiness ? 0 : (template.taxRate != null ? template.taxRate : 19), // Use template tax rate or default to 19%, but 0 for small business
            unit: template.unit || 'Stück',
            templateId: template.id,
            total: unitPrice * 1 // quantity * unitPrice
          };
        } else {
          // Fallback if template not found
          newMaterial = {
            id: generateUUID(),
            description: '',
            quantity: 1,
            unitPrice: 0,
            taxRate: company?.isSmallBusiness ? 0 : 19, // Default tax rate, but 0 for small business
            unit: 'Stück',
            total: 0
          };
        }
      } catch (error) {
        logger.error('Error loading material template:', error);
        // Fallback on error
        newMaterial = {
          id: generateUUID(),
          description: '',
          quantity: 1,
          unitPrice: 0,
          taxRate: company?.isSmallBusiness ? 0 : 19, // Default tax rate, but 0 for small business
          unit: 'Stück',
          total: 0
        };
      }
    } else {
      // Manual entry
      newMaterial = {
        id: generateUUID(),
        description: '',
        quantity: 1,
        unitPrice: 0,
        taxRate: company?.isSmallBusiness ? 0 : 19, // Default tax rate, but 0 for small business
        unit: 'Stück',
        total: 0
      };
    }
    
    setFormData(prev => ({
      ...prev,
      materials: [...(prev.materials || []), newMaterial]
    }));
  };

  const updateMaterial = (id: string, field: string, value: string | number | undefined) => {
    setFormData(prev => ({
      ...prev,
      materials: (prev.materials || []).map(material => {
        if (material.id !== id) return material;
        const updated = { ...material, [field]: value };
        return withDiscount(updated, parseFloat(String(updated.quantity)) || 0, parseFloat(String(updated.unitPrice)) || 0);
      })
    }));
  };

  const removeMaterial = (id: string) => {
    setFormData(prev => ({
      ...prev,
      materials: (prev.materials || []).filter(material => material.id !== id)
    }));
  };

  const reorderMaterials = (fromIndex: number, toIndex: number) => {
    setFormData(prev => ({ ...prev, materials: arrayMove(prev.materials || [], fromIndex, toIndex) }));
  };


  const handleAttachmentsChange = (attachments: JobAttachment[]) => {
    setFormData(prev => ({
      ...prev,
      attachments
    }));
  };

  const handlePreview = (attachments: (JobAttachment)[], initialIndex: number) => {
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

  const handleSignature = () => {
    // Check if customer is selected
    if (!formData.customerId) {
      alert('Bitte wählen Sie zuerst einen Kunden aus.');
      return;
    }
    setShowSignaturePad(true);
  };

  const handleSignatureSave = (signatureData: string, customerName: string) => {
    const signature: JobSignature = {
      id: generateUUID(),
      customerName: customerName.trim(),
      signatureData,
      signedAt: new Date(),
      ipAddress: undefined // Will be set by backend
    };
    
    setFormData(prev => ({
      ...prev,
      signature,
      status: 'completed' // Automatically set to completed when signed
    }));
    
    setShowSignaturePad(false);
  };

  const handleSignatureClose = () => {
    setShowSignaturePad(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.customerId || !formData.title || !formData.description) {
      alert('Bitte füllen Sie alle Pflichtfelder aus.');
      return;
    }
    
    // Convert date to string format for backend
    const submitData = {
      ...formData,
      date: formData.date instanceof Date ? formData.date.toISOString().split('T')[0] : formData.date
    };
    
    onSubmit(submitData);
  };

  const handleSubmitAsDraft = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.customerId || !formData.title || !formData.description) {
      alert('Bitte füllen Sie alle Pflichtfelder aus.');
      return;
    }
    
    // Convert date to string format for backend
    const submitData = {
      ...formData,
      status: 'draft' as const,
      date: formData.date instanceof Date ? formData.date.toISOString().split('T')[0] : formData.date
    };
    
    onSubmit(submitData);
  };

  const formatDateForInput = (date: Date) => {
    return new Date(date).toISOString().split('T')[0];
  };

  const isSmallBusiness = company?.isSmallBusiness || false;
  const discountsEnabled = company.discountsEnabled !== false;

  const toLineItem = (
    entry: { id: string; description: string; taxRate: number; discountType?: 'percentage' | 'fixed'; discountValue?: number },
    quantity: number,
    unitPrice: number
  ): LineItem => ({
    id: entry.id,
    description: entry.description,
    quantity,
    unitPrice,
    taxRate: Number(entry.taxRate) || 0,
    discountType: entry.discountType,
    discountValue: entry.discountValue,
    discountAmount: calculateItemDiscount(Number(quantity) || 0, Number(unitPrice) || 0, entry.discountType, entry.discountValue),
  });

  const timeEntryItems = (formData.timeEntries || []).map(entry => toLineItem(entry, entry.hoursWorked, entry.hourlyRate));
  const materialItems = (formData.materials || []).map(material => toLineItem(material, material.quantity, material.unitPrice));

  // Summen wie auf der späteren Auftragsrechnung (gleiche Rechenlogik)
  const totals = calculateInvoiceWithDiscounts(
    buildInvoiceItemsFromJobs([{ ...formData, id: job?.id || 'neu' } as JobEntry], isSmallBusiness),
    { type: formData.globalDiscountType, value: formData.globalDiscountValue },
    isSmallBusiness
  );
  const hasPositions = timeEntryItems.length > 0 || materialItems.length > 0 || formData.hoursWorked > 0;

  return (
    <div>
      <PageShell
        title={job ? 'Auftrag bearbeiten' : 'Neuer Auftrag'}
        subtitle={job ? job.title : 'Erfassen Sie einen neuen Auftrag'}
        onClose={onCancel}
        header={job ? <DocumentChain kind="job" id={job.id} /> : undefined}
        footer={
          <>
            <button
              type="button"
              onClick={onCancel}
              className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Abbrechen
            </button>
            {!job && (
              <button
                type="button"
                onClick={handleSubmitAsDraft}
                className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center space-x-2"
              >
                <Save className="h-4 w-4" />
                <span>Als Entwurf speichern</span>
              </button>
            )}
            <button
              type="submit"
              form="job-form"
              className="px-6 py-2 btn-primary rounded-lg transition-colors flex items-center justify-center space-x-2"
            >
              <Save className="h-4 w-4" />
              <span>{job ? 'Aktualisieren' : 'Erstellen'}</span>
            </button>
          </>
        }
      >
        <form id="job-form" onSubmit={handleSubmit} className="space-y-6">
          <FormSection title="Grundinformationen">
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className={fieldLabelClass}>
                  Auftragsnummer
                </label>
                <input
                  type="text"
                  value={formData.jobNumber}
                  placeholder={job ? "" : "Wird automatisch generiert"}
                  disabled={true}
                  readOnly={true}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {job ? "Auftragsnummern können nach der Erstellung nicht mehr geändert werden" : "Die Auftragsnummer wird beim Speichern automatisch generiert"}
                </p>
              </div>

              <div>
                <label className={fieldLabelClass}>
                  Externe Auftragsnummer
                </label>
                <input
                  type="text"
                  value={formData.externalJobNumber}
                  onChange={(e) => setFormData(prev => ({ ...prev, externalJobNumber: e.target.value }))}
                  className={fieldInputClass}
                  placeholder="Optional: Externe Referenznummer"
                />
              </div>

              <CustomerPicker
                customers={customers}
                selectedId={formData.customerId}
                onSelect={handleCustomerSelect}
                onCreateNew={() => setShowCustomerForm(true)}
              />

              <div>
                <label className={fieldLabelClass}>
                  Titel *
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  required
                  className={fieldInputClass}
                  placeholder="z.B. Website-Entwicklung"
                />
              </div>

              <div>
                <label className={fieldLabelClass}>
                  Auftragsdatum *
                </label>
                <input
                  type="date"
                  value={formatDateForInput(formData.date)}
                  onChange={(e) => setFormData(prev => ({ ...prev, date: new Date(e.target.value) }))}
                  required
                  className={fieldInputClass}
                />
              </div>

              <div>
                <label className={fieldLabelClass}>
                  Status
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value as JobEntry['status'] }))}
                  className={fieldInputClass}
                >
                  <option value="draft">Entwurf</option>
                  <option value="in-progress">In Bearbeitung</option>
                  <option value="completed">Abgeschlossen</option>
                  <option value="invoiced">Abgerechnet</option>
                </select>
              </div>

              <div>
                <label className={fieldLabelClass}>
                  Kundenanschrift (Ausführungsort)
                </label>
                <textarea
                  value={formData.customerAddress || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, customerAddress: e.target.value }))}
                  rows={3}
                  className={fieldInputClass}
                  placeholder={"z.B. Max Mustermann\nMusterstraße 123\n12345 Musterstadt"}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Optional, falls abweichend vom Rechnungsempfänger
                </p>
              </div>

              <div>
                <label className={fieldLabelClass}>
                  Beschreibung *
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  required
                  rows={2}
                  className={fieldInputClass}
                  placeholder="Detaillierte Beschreibung der Arbeiten..."
                />
              </div>
            </div>
          </FormSection>

          <FormSection title="Zeiterfassung">
            <TemplateAddBar
              groups={[{
                label: 'Stundensätze',
                options: getCombinedHourlyRatesForCustomer(formData.customerId).map(rate => ({
                  value: rate.id,
                  label: `${rate.displayName} - ${parseFloat(String(rate.rate || 0)).toFixed(2)}€/h`,
                })),
              }]}
              onSelect={addTimeEntryFromTemplate}
              onManage={() => setShowRatesRedirectModal({ isOpen: true, type: 'hourlyRates' })}
              manageTitle="Stundensätze verwalten"
              onAddManual={addTimeEntry}
            />
            <LineItemList
              items={timeEntryItems}
              onUpdate={updateTimeEntry}
              onRemove={removeTimeEntry}
              onReorder={reorderTimeEntries}
              isSmallBusiness={isSmallBusiness}
              discountsEnabled={discountsEnabled}
              quantityLabel="Stunden"
              priceLabel="Satz"
              priceReadOnly
              emptyText="Noch keine Zeiteinträge erfasst."
            />
            {timeEntryItems.length > 0 && (
              <div className="flex justify-between text-sm text-gray-600 mt-4">
                <span>Gesamtstunden:</span>
                <span className="font-medium text-gray-900">{totalHoursOf(formData.timeEntries || []).toFixed(2)} h</span>
              </div>
            )}
          </FormSection>

          <FormSection title="Materialien & Zusatzkosten">
            <TemplateAddBar
              groups={[{
                label: 'Materialien',
                options: getCombinedMaterialTemplatesForCustomer(formData.customerId).map(template => ({
                  value: template.id,
                  label: `${template.displayName} - ${parseFloat(String(template.unitPrice || 0)).toFixed(2)}€/${template.unit || 'Stück'}`,
                })),
              }]}
              onSelect={(templateId) => addMaterial(templateId)}
              onManage={() => setShowRatesRedirectModal({ isOpen: true, type: 'materials' })}
              manageTitle="Materialien verwalten"
              onAddManual={() => addMaterial()}
            />
            <LineItemList
              items={materialItems}
              onUpdate={updateMaterial}
              onRemove={removeMaterial}
              onReorder={reorderMaterials}
              isSmallBusiness={isSmallBusiness}
              discountsEnabled={discountsEnabled}
              emptyText="Noch keine Materialien hinzugefügt."
            />
          </FormSection>

          {/* Gesamtrabatt: wird bei der Abrechnung auf die Rechnung übernommen */}
          {hasPositions && (discountsEnabled || formData.globalDiscountType) && (
            <GlobalDiscountSection
              type={formData.globalDiscountType}
              value={formData.globalDiscountValue}
              amount={totals.globalDiscountAmount}
              onChange={({ type, value }) => setFormData(prev => ({ ...prev, globalDiscountType: type, globalDiscountValue: value }))}
              hint="Der Gesamtrabatt wird bei der Abrechnung auf die Rechnung angewendet (nach Positionsrabatten)."
            />
          )}

          {hasPositions && (
            <DocumentTotals
              totals={totals}
              discountsEnabled={discountsEnabled}
              isSmallBusiness={isSmallBusiness}
            />
          )}

          <FormSection title="Notizen">
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              rows={4}
              className={`${fieldInputClass} resize-none`}
              placeholder="Zusätzliche Notizen oder Kommentare..."
            />
          </FormSection>

          <FormSection title="Anhänge">
            <AttachmentManager
              attachments={formData.attachments || []}
              onAttachmentsChange={handleAttachmentsChange}
              allowUpload={true}
              allowPreview={true}
              onPreview={handlePreview}
            />
          </FormSection>

          <FormSection title="Kundenunterschrift">
            {formData.signature ? (
              <div className="border border-gray-300 rounded-lg p-3 bg-green-50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-green-800">
                    Unterschrift vorhanden
                  </span>
                  <span className="text-xs text-green-600">
                    {new Date(formData.signature.signedAt).toLocaleString('de-DE')}
                  </span>
                </div>
                <div className="text-sm text-gray-700 mb-2">
                  Kunde: <strong>{formData.signature.customerName}</strong>
                </div>
                <img 
                  src={formData.signature.signatureData} 
                  alt="Kundenunterschrift" 
                  className="max-h-20 border border-gray-200 rounded bg-white"
                />
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-600 mb-3">
                  Noch keine Unterschrift vorhanden. Nach dem Hinzufügen einer Unterschrift wird der Auftrag automatisch als "Abgeschlossen" markiert.
                </p>
                <button
                  type="button"
                  onClick={handleSignature}
                  disabled={!formData.customerId}
                  className="inline-flex items-center px-3 py-2 border border-purple-300 rounded-lg text-sm font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <PenTool className="h-4 w-4 mr-2" />
                  Unterschrift hinzufügen
                </button>
                {!formData.customerId && (
                  <p className="text-xs text-red-600 mt-1">
                    Bitte wählen Sie zuerst einen Kunden aus.
                  </p>
                )}
              </div>
            )}
          </FormSection>
        </form>
      </PageShell>

      {showCustomerForm && (
        <CustomerCreateModal
          onClose={() => setShowCustomerForm(false)}
          onCreated={handleCustomerSelect}
        />
      )}

      {/* Signature Pad Modal */}
      <SignaturePad
        isOpen={showSignaturePad}
        onClose={handleSignatureClose}
        onSave={handleSignatureSave}
        title="Kundenunterschrift"
        initialCustomerName={formData.customerName}
      />

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
