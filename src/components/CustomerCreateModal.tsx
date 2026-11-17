import React, { useState } from 'react';
import { Modal } from './Modal';
import { useCustomers } from '../context/CustomerContext';
import { findDuplicateCustomer, showDuplicateCustomerAlert } from '../utils/customerUtils';
import logger from '../utils/logger';
import { Customer } from '../types';

interface CustomerCreateModalProps {
  onClose: () => void;
  /** Wird nach erfolgreichem Anlegen mit dem neuen Kunden aufgerufen (z. B. zum Vorauswählen). */
  onCreated?: (customer: Customer) => void;
}

const EMPTY = {
  name: '',
  email: '',
  address: '',
  addressSupplement: '',
  postalCode: '',
  city: '',
  country: 'Deutschland',
  taxId: '',
  phone: '',
};

const FORM_ID = 'customer-create-form';
const INPUT = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom';

export function CustomerCreateModal({ onClose, onCreated }: CustomerCreateModalProps) {
  const { customers, addCustomer, refreshCustomers } = useCustomers();
  const [data, setData] = useState(EMPTY);
  const [isSaving, setIsSaving] = useState(false);

  const set = (field: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setData(prev => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const existing = findDuplicateCustomer(customers, data);
    if (existing) {
      showDuplicateCustomerAlert(existing);
      return;
    }

    setIsSaving(true);
    try {
      const created = await addCustomer(data);
      await refreshCustomers();
      if (created?.id) onCreated?.(created);
      onClose();
    } catch (error) {
      logger.error('Failed to create customer', { error: (error as Error).message });
      alert('Fehler beim Erstellen des Kunden. Bitte versuchen Sie es erneut.');
      setIsSaving(false);
    }
  };

  return (
    <Modal
      title="Neuer Kunde"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="bg-gray-300 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-400 transition-colors"
          >
            Abbrechen
          </button>
          <button
            type="submit"
            form={FORM_ID}
            disabled={isSaving}
            className="bg-primary-custom text-white py-2 px-4 rounded-lg hover:bg-primary-custom/90 transition-colors disabled:opacity-50"
          >
            Kunde erstellen
          </button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
          <input type="text" required value={data.name} onChange={set('name')} className={INPUT} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">E-Mail</label>
          <input type="email" value={data.email} onChange={set('email')} className={INPUT} placeholder="optional" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Adresse *</label>
          <input type="text" required value={data.address} onChange={set('address')} className={INPUT} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Adresszusatz</label>
          <input
            type="text"
            value={data.addressSupplement}
            onChange={set('addressSupplement')}
            className={INPUT}
            placeholder="z.B. 2. Stock, Hintereingang"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">PLZ *</label>
            <input type="text" required value={data.postalCode} onChange={set('postalCode')} className={INPUT} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Stadt *</label>
            <input type="text" required value={data.city} onChange={set('city')} className={INPUT} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Land *</label>
          <input type="text" required value={data.country} onChange={set('country')} className={INPUT} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">USt-IdNr.</label>
          <input type="text" value={data.taxId} onChange={set('taxId')} className={INPUT} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Telefon</label>
          <input type="tel" value={data.phone} onChange={set('phone')} className={INPUT} />
        </div>
      </form>
    </Modal>
  );
}
