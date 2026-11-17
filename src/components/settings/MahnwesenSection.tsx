import { Clock } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { getSection } from './sections';
import { useSectionForm } from './useSectionForm';
import { SaveBar } from './SaveBar';

const FIELDS = getSection('mahnwesen').fields;

function MahnwesenForm() {
  const form = useSectionForm(FIELDS);
  const { formData, setFormData } = form;

  const handleSave = async () => {
    await form.save();
  };

  return (
    <div className="space-y-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
          <div className="flex items-center mb-4">
            <Clock className="h-5 w-5 text-primary-custom mr-2" />
            <h3 className="text-lg font-semibold text-gray-900">Zahlungserinnerungen Konfiguration</h3>
          </div>
          
          <div className="space-y-6">
            {/* Timing Configuration */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tage nach Fälligkeit bis zur 1. Mahnung
                </label>
                <input
                  type="number"
                  min="0"
                  value={formData.reminderDaysAfterDue ?? 7}
                  onChange={(e) => {
                    const value = e.target.value === '' ? 0 : parseInt(e.target.value, 10);
                    setFormData(prev => ({ ...prev, reminderDaysAfterDue: isNaN(value) ? 0 : value }));
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">0 = sofort nach Fälligkeit mahnbar</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tage zwischen Mahnstufen
                </label>
                <input
                  type="number"
                  min="0"
                  value={formData.reminderDaysBetween ?? 7}
                  onChange={(e) => {
                    const value = e.target.value === '' ? 0 : parseInt(e.target.value, 10);
                    setFormData(prev => ({ ...prev, reminderDaysBetween: isNaN(value) ? 0 : value }));
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">0 = sofort nach letzter Mahnung erneut mahnbar</p>
              </div>
            </div>

            {/* Fee Configuration */}
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-3">Mahngebühren</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    1. Mahnstufe (€)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.reminderFeeStage1 ?? 0}
                    onChange={(e) => {
                      const value = e.target.value === '' ? 0 : parseFloat(e.target.value);
                      setFormData(prev => ({ ...prev, reminderFeeStage1: isNaN(value) ? 0 : value }));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    2. Mahnstufe (€)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.reminderFeeStage2 ?? 0}
                    onChange={(e) => {
                      const value = e.target.value === '' ? 0 : parseFloat(e.target.value);
                      setFormData(prev => ({ ...prev, reminderFeeStage2: isNaN(value) ? 0 : value }));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    3. Mahnstufe (€)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.reminderFeeStage3 ?? 0}
                    onChange={(e) => {
                      const value = e.target.value === '' ? 0 : parseFloat(e.target.value);
                      setFormData(prev => ({ ...prev, reminderFeeStage3: isNaN(value) ? 0 : value }));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">Geben Sie 0 ein, wenn keine Mahngebühren erhoben werden sollen</p>
            </div>

            {/* Reminder Texts */}
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-3">Mahntexte</h4>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    1. Mahnung (freundlich)
                  </label>
                  <textarea
                    value={formData.reminderTextStage1 || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, reminderTextStage1: e.target.value }))}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent"
                    placeholder="Freundliche Zahlungserinnerung..."
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    2. Mahnung (bestimmt)
                  </label>
                  <textarea
                    value={formData.reminderTextStage2 || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, reminderTextStage2: e.target.value }))}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent"
                    placeholder="Bestimmte Zahlungsaufforderung..."
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    3. Mahnung (letzte Mahnung)
                  </label>
                  <textarea
                    value={formData.reminderTextStage3 || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, reminderTextStage3: e.target.value }))}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-custom focus:border-transparent"
                    placeholder="Letzte Mahnung vor rechtlichen Schritten..."
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      <SaveBar {...form} discard={form.discard} onSave={handleSave} />
    </div>
  );
}

export function MahnwesenSection({ onNavigate }: { onNavigate: (id: 'module') => void }) {
  const { company } = useCompany();
  if (!company.remindersEnabled) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6 text-sm text-gray-700">
        Zahlungserinnerungen sind deaktiviert –{' '}
        <button type="button" onClick={() => onNavigate('module')} className="text-primary-custom underline">
          unter Module aktivieren
        </button>
        .
      </div>
    );
  }
  return <MahnwesenForm />;
}
