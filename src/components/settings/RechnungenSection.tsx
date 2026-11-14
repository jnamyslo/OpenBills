import { FileText, Globe } from 'lucide-react';
import { getSection } from './sections';
import { useSectionForm } from './useSectionForm';
import { SaveBar } from './SaveBar';

const FIELDS = getSection('rechnungen').fields;

export function RechnungenSection() {
  const form = useSectionForm(FIELDS);
  const { formData, setFormData } = form;

  const handleSave = async () => {
    await form.save();
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
        <div className="flex items-center mb-4">
          <FileText className="h-5 w-5 text-primary-custom mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">Rechnungseinstellungen</h3>
        </div>
        
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 className="font-medium text-blue-900 mb-2">💡 Hinweis zur Start-Rechnungsnummer</h4>
          <p className="text-sm text-blue-800">
            Die Start-Rechnungsnummer wird nur bei neuen Systemen oder beim Jahreswechsel verwendet. 
            Wenn bereits Rechnungen existieren, wird immer von der höchsten vorhandenen Nummer weiter gezählt.
            Format: RE-{new Date().getFullYear()}-XXX (z.B. RE-{new Date().getFullYear()}-56)
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Standard-Zahlungsziel (Tage) *
            </label>
            <input
              type="number"
              required
              min="0"
              max="365"
              value={formData.defaultPaymentDays !== undefined ? formData.defaultPaymentDays : 30}
              onChange={(e) => {
                const value = parseInt(e.target.value);
                setFormData(prev => ({ ...prev, defaultPaymentDays: isNaN(value) ? 30 : value }));
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Anzahl der Tage, nach denen eine Rechnung fällig wird. Bei 0 Tagen ist die Rechnung sofort fällig.
            </p>
          </div>
        </div>

        {/* Immediate Payment Clause Settings */}
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Sofortzahlungsklausel (bei 0 Tagen Zahlungsziel)
          </label>
          <textarea
            value={formData.immediatePaymentClause || 'Rechnung ist per sofort fällig, ohne Abzug'}
            onChange={(e) => setFormData(prev => ({ ...prev, immediatePaymentClause: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={2}
            placeholder="Text, der bei sofortiger Zahlung in der Rechnung angezeigt wird"
          />
          <p className="text-xs text-gray-500 mt-1">
            Diese Klausel wird in Rechnungen mit 0 Tagen Zahlungsziel in den Zahlungsbedingungen angezeigt.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
        <div className="flex items-center mb-4">
          <Globe className="h-5 w-5 text-primary-custom mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">Sprache und Formatierung</h3>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Locale (Zahlenformat)
            </label>
            <select
              value={formData.locale || 'de-DE'}
              onChange={(e) => setFormData(prev => ({ ...prev, locale: e.target.value as 'de-DE' | 'en-US' | 'fr-FR' | 'es-ES' }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="de-DE">Deutsch (Deutschland) - 1.234,56 €</option>
              <option value="en-US">English (United States) - $1,234.56</option>
              <option value="fr-FR">Français (France) - 1 234,56 €</option>
              <option value="es-ES">Español (España) - 1.234,56 €</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Bestimmt das Format für Zahlen und Währungen
            </p>
          </div>
        </div>
      </div>
      <SaveBar {...form} discard={form.discard} onSave={handleSave} />
    </div>
  );
}
