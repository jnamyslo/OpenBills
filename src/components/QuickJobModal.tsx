import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { Modal } from './Modal';
import { CustomerCreateModal } from './CustomerCreateModal';
import { useCompany } from '../context/CompanyContext';
import { Customer, JobEntry } from '../types';
import { CustomerSelect } from './CustomerSelect';

export type QuickJobValues = Pick<JobEntry, 'customerId' | 'customerName' | 'customerAddress' | 'title' | 'description'>;

interface QuickJobModalProps {
  date: Date;
  customers: Customer[];
  onSubmit: (jobData: Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  /** Öffnet die volle Auftragsseite mit den bisher eingegebenen Werten. */
  onOpenDetails: (values: QuickJobValues, date: Date) => void;
  onClose: () => void;
}

const FORM_ID = 'quick-job-form';
const INPUT = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom';

const toDateInput = (d: Date) => d.toISOString().split('T')[0];

export function QuickJobModal({ date, customers, onSubmit, onOpenDetails, onClose }: QuickJobModalProps) {
  const { getHourlyRates } = useCompany();
  const [dateValue, setDateValue] = useState(toDateInput(date));
  const [customerId, setCustomerId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const customer = customers.find(c => c.id === customerId);
  // Datum als Mittag UTC, damit der Tag unabhängig von der Zeitzone erhalten bleibt
  const jobDate = () => new Date(`${dateValue}T12:00:00.000Z`);
  const values = (): QuickJobValues => ({
    customerId,
    customerName: customer?.name || '',
    customerAddress: customer?.address || '',
    title,
    description,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const defaultRate = getHourlyRates().find(rate => rate.isDefault);
    setIsSaving(true);
    try {
      await onSubmit({
        ...values(),
        jobNumber: '',
        date: jobDate(),
        hoursWorked: 0,
        hourlyRate: defaultRate?.rate ?? 0,
        hourlyRateId: defaultRate?.id ?? '',
        timeEntries: [],
        materials: [],
        status: 'draft',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Modal
        title="Neuer Auftrag"
        onClose={onClose}
        zClass="z-50"
        footer={
          <>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={() => onOpenDetails(values(), jobDate())}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Alle Details …
            </button>
            <button
              type="submit"
              form={FORM_ID}
              disabled={isSaving || !customerId}
              className="btn-primary text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            >
              Als Entwurf anlegen
            </button>
          </>
        }
      >
        <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Datum *</label>
            <input type="date" required value={dateValue} onChange={e => setDateValue(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Kunde *</label>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <CustomerSelect customers={customers} value={customerId} onChange={setCustomerId} />
              </div>
              <button
                type="button"
                onClick={() => setShowCustomerForm(true)}
                className="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors flex items-center text-sm"
                title="Neuen Kunden anlegen"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Titel *</label>
            <input type="text" required value={title} onChange={e => setTitle(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Beschreibung *</label>
            <textarea required rows={3} value={description} onChange={e => setDescription(e.target.value)} className={`${INPUT} resize-none`} />
          </div>
        </form>
      </Modal>

      {showCustomerForm && (
        <CustomerCreateModal
          onClose={() => setShowCustomerForm(false)}
          onCreated={c => setCustomerId(c.id)}
        />
      )}
    </>
  );
}
