import { Building2, Mail } from 'lucide-react';
import { updatePageTitle } from '../../utils/faviconUtils';
import { getSection } from './sections';
import { useSectionForm } from './useSectionForm';
import { SaveBar } from './SaveBar';

const FIELDS = getSection('firmenprofil').fields;

export function FirmenprofilSection() {
  const form = useSectionForm(FIELDS);
  const { formData, setFormData } = form;

  const handleSave = async () => {
    const ok = await form.save();
    if (ok && formData.name) updatePageTitle(formData.name);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
        <div className="flex items-center mb-4">
          <Building2 className="h-5 w-5 text-primary-custom mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">Firmendaten</h3>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Firmenname *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          {/* Company Header Layout Options */}
          <div className="md:col-span-2">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <h4 className="font-medium text-blue-900 mb-2">📄 PDF-Header Layout</h4>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <label className="text-sm font-medium text-blue-800">
                    Zweizeilige Darstellung der Firmeninformationen im PDF-Header
                  </label>
                  <p className="text-xs text-blue-600 mt-1">
                    Ermöglicht eine strukturiertere Darstellung im PDF-Kopfbereich
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.companyHeaderTwoLine || false}
                    onChange={(e) => setFormData(prev => ({ ...prev, companyHeaderTwoLine: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-custom/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-custom"></div>
                </label>
              </div>
              
              {formData.companyHeaderTwoLine && (
                <div className="space-y-3 ml-0 mt-4">
                  <div>
                    <label className="block text-sm font-medium text-blue-700 mb-1">
                      Erste Zeile (z.B. Firmenbezeichnung/Service)
                    </label>
                    <input
                      type="text"
                      value={formData.companyHeaderLine1 || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, companyHeaderLine1: e.target.value }))}
                      placeholder="z.B. Musterfirma Service & Beratung GmbH"
                      className="w-full px-3 py-2 border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-blue-700 mb-1">
                      Zweite Zeile (z.B. Inhaber, Adresse)
                    </label>
                    <input
                      type="text"
                      value={formData.companyHeaderLine2 || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, companyHeaderLine2: e.target.value }))}
                      placeholder="z.B. Max Mustermann, Musterstraße 123, 12345 Musterstadt"
                      className="w-full px-3 py-2 border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <p className="text-xs text-blue-600">
                    Diese Einstellung beeinflusst nur die Darstellung im PDF-Sender-Bereich. 
                    Lassen Sie die Felder leer, um die automatische Generierung zu verwenden.
                  </p>
                </div>
              )}
            </div>
          </div>
          
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Adresse *
            </label>
            <input
              type="text"
              required
              value={formData.address}
              onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Postleitzahl *
            </label>
            <input
              type="text"
              required
              value={formData.postalCode}
              onChange={(e) => setFormData(prev => ({ ...prev, postalCode: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Stadt *
            </label>
            <input
              type="text"
              required
              value={formData.city}
              onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Land *
            </label>
            <input
              type="text"
              required
              value={formData.country}
              onChange={(e) => setFormData(prev => ({ ...prev, country: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              USt-IdNr. *
            </label>
            <input
              type="text"
              required
              value={formData.taxId}
              onChange={(e) => setFormData(prev => ({ ...prev, taxId: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="z.B. DE123456789"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Steuer-ID
            </label>
            <input
              type="text"
              value={formData.taxIdentificationNumber || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, taxIdentificationNumber: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="z.B. 123/456/78910"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
        <div className="flex items-center mb-4">
          <Mail className="h-5 w-5 text-primary-custom mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">Kontaktdaten</h3>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              E-Mail *
            </label>
            <input
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Telefon *
            </label>
            <input
              type="tel"
              required
              value={formData.phone}
              onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Website
            </label>
            <input
              type="text"
              value={formData.website || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, website: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>
      <SaveBar {...form} discard={form.discard} onSave={handleSave} />
    </div>
  );
}
