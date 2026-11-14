import { useEffect, useState } from 'react';
import { Clock, Edit2, Package, Plus, Trash2, X } from 'lucide-react';
import logger from '../../utils/logger';
import { apiService } from '../../services/api';
import { useCompany } from '../../context/CompanyContext';
import { usePlan } from '../../context/PlanContext';
import { PlanLockedNotice } from '../PlanLockedNotice';
import { HourlyRate, MaterialTemplate } from '../../types';

export function LeistungenSection() {
  const { company, updateCompany } = useCompany();
  const { hasFeature } = usePlan();
  const [savingDropdowns, setSavingDropdowns] = useState(false);
  const [dropdownError, setDropdownError] = useState(false);

  const [materialTemplates, setMaterialTemplates] = useState<MaterialTemplate[]>([]);
  const [editingMaterial, setEditingMaterial] = useState<MaterialTemplate | null>(null);
  const [isAddingMaterial, setIsAddingMaterial] = useState(false);

  const [hourlyRates, setHourlyRates] = useState<HourlyRate[]>([]);
  const [editingRate, setEditingRate] = useState<HourlyRate | null>(null);
  const [isAddingRate, setIsAddingRate] = useState(false);

  useEffect(() => {
    loadMaterialTemplates();
    loadHourlyRates();
  }, []);

  // Sofort speichern: Leistungen hat keine Speichern-Leiste.
  const handleToggleCombinedDropdowns = async (value: boolean) => {
    setSavingDropdowns(true);
    setDropdownError(false);
    try {
      await updateCompany({ ...company, showCombinedDropdowns: value });
    } catch (error) {
      logger.error('Error saving showCombinedDropdowns:', error);
      setDropdownError(true);
    } finally {
      setSavingDropdowns(false);
    }
  };

  // Material Templates Functions
  const loadMaterialTemplates = async () => {
    try {
      const templates = await apiService.getMaterialTemplates();
      setMaterialTemplates(templates);
    } catch (error) {
      logger.error('Error loading material templates:', error);
    }
  };

  const handleSaveMaterial = async (material: Omit<MaterialTemplate, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      if (editingMaterial) {
        await apiService.updateMaterialTemplate(editingMaterial.id, material);
      } else {
        await apiService.createMaterialTemplate(material);
      }
      await loadMaterialTemplates();
      setEditingMaterial(null);
      setIsAddingMaterial(false);
    } catch (error) {
      logger.error('Error saving material template:', error);
    }
  };

  const handleDeleteMaterial = async (id: string) => {
    try {
      await apiService.deleteMaterialTemplate(id);
      await loadMaterialTemplates();
    } catch (error) {
      logger.error('Error deleting material template:', error);
    }
  };

  // Hourly Rates Functions
  const loadHourlyRates = async () => {
    try {
      const rates = await apiService.getHourlyRates();
      setHourlyRates(rates);
    } catch (error) {
      logger.error('Error loading hourly rates:', error);
    }
  };

  const handleSaveRate = async (rate: Omit<HourlyRate, 'id'>) => {
    try {
      if (editingRate) {
        await apiService.updateHourlyRate(editingRate.id, rate);
      } else {
        await apiService.createHourlyRate(rate);
      }
      await loadHourlyRates();
      setEditingRate(null);
      setIsAddingRate(false);
    } catch (error) {
      logger.error('Error saving hourly rate:', error);
    }
  };

  const handleDeleteRate = async (id: string) => {
    try {
      await apiService.deleteHourlyRate(id);
      await loadHourlyRates();
    } catch (error) {
      logger.error('Error deleting hourly rate:', error);
    }
  };

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
        <div className="flex items-center mb-4">
          <Package className="h-5 w-5 text-primary-custom mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">Positionsverwaltung</h3>
        </div>

        {/* Combined Dropdowns Setting */}
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-blue-900 mb-2">
                Erweiterte Dropdown-Anzeige
              </h4>
              <p className="text-sm text-blue-800 mb-3">
                Wenn aktiviert, werden in den Dropdowns für Stundensätze und Materialien sowohl allgemeine als auch kundenspezifische Einträge angezeigt. Dies ermöglicht eine bessere Übersicht aller verfügbaren Optionen.
              </p>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="showCombinedDropdowns"
                  checked={company.showCombinedDropdowns === true} // Default to false
                  disabled={savingDropdowns}
                  onChange={(e) => handleToggleCombinedDropdowns(e.target.checked)}
                  className="custom-checkbox"
                />
                <label htmlFor="showCombinedDropdowns" className="ml-2 text-sm font-medium text-blue-900">
                  Allgemeine und kundenspezifische Daten in Dropdowns kombinieren
                </label>
              </div>
              {dropdownError && <p className="text-sm text-red-600 mt-2">Speichern fehlgeschlagen</p>}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {/* Hourly Rates Management */}
          <div className="border-b border-gray-200 pb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <Clock className="h-4 w-4 text-primary-custom mr-2" />
                <h4 className="text-md font-semibold text-gray-800">Stundensätze</h4>
              </div>
              <button
                type="button"
                onClick={() => setIsAddingRate(true)}
                className="inline-flex items-center px-3 py-2 bg-primary-custom text-white rounded-lg hover:brightness-90 transition-colors"
              >
                <Plus className="h-4 w-4 mr-2" />
                Stundensatz hinzufügen
              </button>
            </div>

            {/* Hourly Rates List */}
            <div className="space-y-3">
              {hourlyRates.map((rate) => (
                <div key={rate.id} className={`p-3 rounded-lg border ${rate.isDefault ? 'border-primary-custom bg-primary-custom/5' : 'border-gray-200 bg-gray-50'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3">
                        <h5 className="font-medium text-gray-900">{rate.name}</h5>
                        {rate.isDefault && (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary-custom text-white">
                            Standard
                          </span>
                        )}
                      </div>
                      {rate.description && (
                        <p className="text-sm text-gray-600 mt-1">{rate.description}</p>
                      )}
                      <p className="text-sm font-semibold text-primary-custom mt-1">
                        {rate.rate.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} / Stunde
                      </p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => setEditingRate(rate)}
                        className="text-primary-custom hover:text-primary-custom/80 p-1"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteRate(rate.id)}
                        className="text-red-600 hover:text-red-800 p-1"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {hasFeature('customerPricing') ? (
            <>
            {/* Material Templates Management */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                  <Package className="h-4 w-4 text-primary-custom mr-2" />
                  <h4 className="text-md font-semibold text-gray-800">Materialvorlagen</h4>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAddingMaterial(true)}
                  className="inline-flex items-center px-3 py-2 bg-primary-custom text-white rounded-lg hover:brightness-90 transition-colors"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Material hinzufügen
                </button>
              </div>

              {/* Material Templates List */}
              <div className="space-y-3">
                {materialTemplates.map((template) => (
                  <div key={template.id} className={`p-3 rounded-lg border ${template.isDefault ? 'border-primary-custom bg-primary-custom/5' : 'border-gray-200 bg-gray-50'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3">
                          <h5 className="font-medium text-gray-900">{template.name}</h5>
                          {template.isDefault && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary-custom text-white">
                              Standard
                            </span>
                          )}
                        </div>
                        {template.description && (
                          <p className="text-sm text-gray-600 mt-1">{template.description}</p>
                        )}
                        <p className="text-sm font-semibold text-primary-custom mt-1">
                          {template.unitPrice.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} / {template.unit}
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => setEditingMaterial(template)}
                          className="text-primary-custom hover:text-primary-custom/80 p-1"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteMaterial(template.id)}
                          className="text-red-600 hover:text-red-800 p-1"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            </>
          ) : (
            <PlanLockedNotice feature="customerPricing" compact />
          )}
        </div>
      </div>

      {(isAddingRate || editingRate) && (
        <HourlyRateModal
          rate={editingRate}
          onSave={handleSaveRate}
          onClose={() => {
            setIsAddingRate(false);
            setEditingRate(null);
          }}
        />
      )}

      {(isAddingMaterial || editingMaterial) && (
        <MaterialTemplateModal
          template={editingMaterial}
          onSave={handleSaveMaterial}
          onClose={() => {
            setIsAddingMaterial(false);
            setEditingMaterial(null);
          }}
        />
      )}
    </>
  );
}
// Hourly Rate Modal Component
interface HourlyRateModalProps {
  rate: HourlyRate | null;
  onSave: (rate: Omit<HourlyRate, 'id'>) => void;
  onClose: () => void;
}

function HourlyRateModal({ rate, onSave, onClose }: HourlyRateModalProps) {
  const [formData, setFormData] = useState({
    name: rate?.name || '',
    description: rate?.description || '',
    rate: rate?.rate || 0,
    isDefault: rate?.isDefault || false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.name && formData.rate > 0) {
      onSave(formData);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">
            {rate ? 'Stundensatz bearbeiten' : 'Neuer Stundensatz'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="z.B. Standard-Stundensatz"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Beschreibung
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Optionale Beschreibung"
              rows={3}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Stundensatz (€) *
            </label>
            <input
              type="number"
              required
              min="0"
              step="0.01"
              value={formData.rate}
              onChange={(e) => setFormData(prev => ({ ...prev, rate: parseFloat(e.target.value) || 0 }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="0,00"
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="isDefaultRate"
              checked={formData.isDefault}
              onChange={(e) => setFormData(prev => ({ ...prev, isDefault: e.target.checked }))}
              className="custom-checkbox"
            />
            <label htmlFor="isDefaultRate" className="ml-2 text-sm text-gray-700">
              Als Standard-Stundensatz festlegen
            </label>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-all duration-300"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-custom text-white rounded-xl hover:brightness-90 transition-all duration-300 hover:scale-105"
            >
              Speichern
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Material Template Modal Component
interface MaterialTemplateModalProps {
  template: MaterialTemplate | null;
  onSave: (template: Omit<MaterialTemplate, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onClose: () => void;
}

function MaterialTemplateModal({ template, onSave, onClose }: MaterialTemplateModalProps) {
  const [formData, setFormData] = useState({
    name: template?.name || '',
    description: template?.description || '',
    unitPrice: template?.unitPrice || 0,
    unit: template?.unit || 'Stück',
    isDefault: template?.isDefault || false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.name && formData.unitPrice > 0) {
      onSave(formData);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">
            {template ? 'Materialvorlage bearbeiten' : 'Neue Materialvorlage'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="z.B. Schrauben M8"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Beschreibung
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Optionale Beschreibung"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Preis (€) *
              </label>
              <input
                type="number"
                required
                min="0"
                step="0.01"
                value={formData.unitPrice}
                onChange={(e) => setFormData(prev => ({ ...prev, unitPrice: parseFloat(e.target.value) || 0 }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0,00"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Einheit
              </label>
              <input
                type="text"
                value={formData.unit}
                onChange={(e) => setFormData(prev => ({ ...prev, unit: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Stück"
              />
            </div>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="isDefaultMaterial"
              checked={formData.isDefault}
              onChange={(e) => setFormData(prev => ({ ...prev, isDefault: e.target.checked }))}
              className="custom-checkbox"
            />
            <label htmlFor="isDefaultMaterial" className="ml-2 text-sm text-gray-700">
              Als Standard-Materialvorlage festlegen
            </label>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-all duration-300"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-custom text-white rounded-xl hover:brightness-90 transition-all duration-300 hover:scale-105"
            >
              Speichern
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
