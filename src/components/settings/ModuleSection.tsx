import { Briefcase } from 'lucide-react';
import { getSection } from './sections';
import { useSectionForm } from './useSectionForm';
import { SaveBar } from './SaveBar';

const FIELDS = getSection('module').fields;

export function ModuleSection() {
  const form = useSectionForm(FIELDS);
  const { formData, setFormData } = form;

  const handleSave = async () => {
    await form.save();
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
        <div className="flex items-center mb-4">
          <Briefcase className="h-5 w-5 text-primary-custom mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">Module</h3>
        </div>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">
                Auftragsmanagement
              </label>
              <p className="text-xs text-gray-500 mt-1">
                Aktiviert das Tracking von Aufträgen und Arbeitszeiten
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.jobTrackingEnabled || false}
                onChange={(e) => setFormData(prev => ({ ...prev, jobTrackingEnabled: e.target.checked }))}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-custom/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-custom"></div>
            </label>
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">
                Reporting & Auswertungen
              </label>
              <p className="text-xs text-gray-500 mt-1">
                Aktiviert Rechnungsjournale, Statistiken und Auswertungen
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.reportingEnabled || false}
                onChange={(e) => setFormData(prev => ({ ...prev, reportingEnabled: e.target.checked }))}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-custom/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-custom"></div>
            </label>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">
                Angebote
              </label>
              <p className="text-xs text-gray-500 mt-1">
                Aktiviert die Erstellung und Verwaltung von Angeboten
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.quotesEnabled || false}
                onChange={(e) => setFormData(prev => ({ ...prev, quotesEnabled: e.target.checked }))}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-custom/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-custom"></div>
            </label>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">
                Rabatt-Funktion
              </label>
              <p className="text-xs text-gray-500 mt-1">
                Ermöglicht Rabatte auf Positions- und Gesamt-Ebene in Rechnungen, Angeboten und Aufträgen
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.discountsEnabled !== false}
                onChange={(e) => setFormData(prev => ({ ...prev, discountsEnabled: e.target.checked }))}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-custom/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-custom"></div>
            </label>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">
                Kleinunternehmerregelung (§ 19 UStG)
              </label>
              <p className="text-xs text-gray-500 mt-1">
                Deaktiviert alle MwSt.-Berechnungen und zeigt entsprechende Klausel auf Rechnungen an
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.isSmallBusiness || false}
                onChange={(e) => setFormData(prev => ({ ...prev, isSmallBusiness: e.target.checked }))}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-custom/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-custom"></div>
            </label>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">
                Zahlungserinnerungen (Mahnwesen)
              </label>
              <p className="text-xs text-gray-500 mt-1">
                Aktiviert das Mahnwesen mit konfigurierbaren Mahnstufen und Mahngebühren
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.remindersEnabled || false}
                onChange={(e) => setFormData(prev => ({ ...prev, remindersEnabled: e.target.checked }))}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-custom/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-custom"></div>
            </label>
          </div>
        </div>
      </div>
      <SaveBar {...form} discard={form.discard} onSave={handleSave} />
    </div>
  );
}
