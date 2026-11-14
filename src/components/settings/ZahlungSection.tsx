import { CreditCard } from 'lucide-react';
import { getSection } from './sections';
import { useSectionForm } from './useSectionForm';
import { SaveBar } from './SaveBar';

const FIELDS = getSection('zahlung').fields;

export function ZahlungSection() {
  const form = useSectionForm(FIELDS);
  const { formData, setFormData } = form;

  const handleSave = async () => {
    await form.save();
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
        <div className="flex items-center mb-4">
          <CreditCard className="h-5 w-5 text-primary-custom mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">Zahlungsinformationen</h3>
        </div>
        
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 className="font-medium text-blue-900 mb-2">💡 Getrennte Verwaltung</h4>
          <p className="text-sm text-blue-800">
            Zahlungsinformationen werden jetzt getrennt von den allgemeinen Firmendaten verwaltet. 
            So können Kontoinhaber und Bankdaten unabhängig vom Firmennamen konfiguriert werden.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Kontoinhaber
            </label>
            <input
              type="text"
              value={formData.paymentInformation?.accountHolder || formData.name}
              onChange={(e) => setFormData(prev => ({ 
                ...prev, 
                paymentInformation: { 
                  ...prev.paymentInformation, 
                  accountHolder: e.target.value 
                }
              }))}
              placeholder={`${formData.name} (Firmenname als Standard)`}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Kann unterschiedlich zum Firmennamen sein (z.B. Geschäftsführer, Inhaber)
            </p>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              IBAN *
            </label>
            <input
              type="text"
              value={formData.paymentInformation?.bankAccount || formData.bankAccount || ''}
              onChange={(e) => setFormData(prev => ({ 
                ...prev, 
                paymentInformation: { 
                  ...prev.paymentInformation, 
                  bankAccount: e.target.value 
                }
              }))}
              placeholder="DE89 3704 0044 0532 0130 00"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              BIC
            </label>
            <input
              type="text"
              value={formData.paymentInformation?.bic || formData.bic || ''}
              onChange={(e) => setFormData(prev => ({ 
                ...prev, 
                paymentInformation: { 
                  ...prev.paymentInformation, 
                  bic: e.target.value 
                }
              }))}
              placeholder="COBADEFFXXX"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bankname
            </label>
            <input
              type="text"
              value={formData.paymentInformation?.bankName || ''}
              onChange={(e) => setFormData(prev => ({ 
                ...prev, 
                paymentInformation: { 
                  ...prev.paymentInformation, 
                  bankName: e.target.value 
                }
              }))}
              placeholder="z.B. Commerzbank AG"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Zusätzliche Zahlungsbedingungen
            </label>
            <textarea
              value={formData.paymentInformation?.paymentTerms || ''}
              onChange={(e) => setFormData(prev => ({ 
                ...prev, 
                paymentInformation: { 
                  ...prev.paymentInformation, 
                  paymentTerms: e.target.value 
                }
              }))}
              placeholder="z.B. Bei Zahlungsrückstand werden Verzugszinsen berechnet"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
            />
            <p className="text-xs text-gray-500 mt-1">
              Diese Bedingungen werden in Rechnungen und Angeboten angezeigt
            </p>
          </div>
        </div>
      </div>
      <SaveBar {...form} discard={form.discard} onSave={handleSave} />
    </div>
  );
}
