import type { ChangeEvent } from 'react';
import { Upload, X, Palette } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { ColorPicker } from '../ColorPicker';
import { updateFavicon } from '../../utils/faviconUtils';
import { getSection } from './sections';
import { useSectionForm } from './useSectionForm';
import { SaveBar } from './SaveBar';

const FIELDS = getSection('erscheinungsbild').fields;

export function ErscheinungsbildSection() {
  const form = useSectionForm(FIELDS);
  const { formData, setFormData } = form;
  const { company } = useCompany();

  const handleLogoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setFormData(prev => ({
          ...prev,
          logo: e.target?.result as string
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLogoRemove = () => {
    setFormData(prev => ({ ...prev, logo: null }));
  };

  const handleIconUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const iconUrl = e.target?.result as string;
        setFormData(prev => ({
          ...prev,
          icon: iconUrl
        }));
        // Update favicon immediately for instant feedback
        updateFavicon(iconUrl);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleIconRemove = () => {
    setFormData(prev => ({ ...prev, icon: null }));
    // Update favicon immediately to remove the custom icon
    updateFavicon(null);
  };

  const handleDiscard = () => {
    form.discard();
    updateFavicon(company.icon ?? null);
  };

  const handleSave = async () => {
    const ok = await form.save();
    if (!ok) return;
    const root = document.documentElement;
    if (formData.primaryColor) root.style.setProperty('--color-primary', formData.primaryColor);
    if (formData.secondaryColor) root.style.setProperty('--color-secondary', formData.secondaryColor);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
        <div className="flex items-center mb-4">
          <Upload className="h-5 w-5 text-primary-custom mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">Firmenlogo</h3>
        </div>
        
        <div className="space-y-4">
          {formData.logo ? (
            <div className="relative inline-block">
              <img
                src={formData.logo}
                alt="Company Logo"
                className="h-20 lg:h-24 object-contain border border-gray-200 rounded-lg"
              />
              <button
                type="button"
                onClick={handleLogoRemove}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-600">Kein Logo hochgeladen</p>
            </div>
          )}
          
          <div>
            <input
              type="file"
              accept="image/*"
              onChange={handleLogoUpload}
              className="hidden"
              id="logo-upload"
            />
            <label
              htmlFor="logo-upload"
              className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 cursor-pointer"
            >
              <Upload className="h-4 w-4 mr-2" />
              Logo hochladen
            </label>
            <p className="text-xs text-gray-500 mt-1">
              Unterstützte Formate: JPG, PNG, GIF. Maximale Größe: 2MB
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
        <div className="flex items-center mb-4">
          <Upload className="h-5 w-5 text-primary-custom mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">Firmen-Icon</h3>
        </div>
        
        <div className="space-y-4">
          {formData.icon ? (
            <div className="relative inline-block">
              <img
                src={formData.icon}
                alt="Company Icon"
                className="h-16 w-16 lg:h-20 lg:w-20 object-contain border border-gray-200 rounded-lg"
              />
              <button
                type="button"
                onClick={handleIconRemove}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-600">Kein Icon hochgeladen</p>
            </div>
          )}
          
          <div>
            <input
              type="file"
              accept="image/*"
              onChange={handleIconUpload}
              className="hidden"
              id="icon-upload"
            />
            <label
              htmlFor="icon-upload"
              className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 cursor-pointer"
            >
              <Upload className="h-4 w-4 mr-2" />
              Icon hochladen
            </label>
            <p className="text-xs text-gray-500 mt-1">
              Unterstützte Formate: JPG, PNG, GIF. Empfohlen: 64x64px oder 128x128px. Maximale Größe: 1MB
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
        <div className="flex items-center mb-4">
          <Palette className="h-5 w-5 text-primary-custom mr-2" />
          <h3 className="text-lg font-semibold text-gray-900">Farbschema</h3>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ColorPicker
            label="Primärfarbe"
            value={formData.primaryColor || '#2563eb'}
            onChange={(color) => setFormData(prev => ({ ...prev, primaryColor: color }))}
            defaultColor="#2563eb"
          />
          <ColorPicker
            label="Sekundärfarbe"
            value={formData.secondaryColor || '#64748b'}
            onChange={(color) => setFormData(prev => ({ ...prev, secondaryColor: color }))}
            defaultColor="#64748b"
          />
        </div>
        
        <div className="mt-4 p-4 bg-gray-50 rounded-lg">
          <h4 className="text-sm font-medium text-gray-700 mb-2">Vorschau</h4>
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-white font-medium"
              style={{ backgroundColor: formData.primaryColor || '#2563eb' }}
            >
              Primäre Aktion
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-white font-medium"
              style={{ backgroundColor: formData.secondaryColor || '#64748b' }}
            >
              Sekundäre Aktion
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Diese Farben werden in der gesamten Anwendung, in PDFs und E-Mails verwendet.
          </p>
        </div>
      </div>
      <SaveBar {...form} discard={handleDiscard} onSave={handleSave} />
    </div>
  );
}
