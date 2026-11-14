import { useEffect, useState } from 'react';
import { FileText, Plus, Trash2 } from 'lucide-react';
import logger from '../../utils/logger';
import { apiService } from '../../services/api';
import { YearlyInvoiceStartNumber } from '../../types';

export function NummernkreiseSection() {
  const [yearlyStartNumbers, setYearlyStartNumbers] = useState<YearlyInvoiceStartNumber[]>([]);
  const [newYear, setNewYear] = useState<number>(new Date().getFullYear());
  const [newStartNumber, setNewStartNumber] = useState<number>(1);

  useEffect(() => {
    loadYearlyStartNumbers();
  }, []);

  const loadYearlyStartNumbers = async () => {
    try {
      const numbers = await apiService.getYearlyInvoiceStartNumbers();
      setYearlyStartNumbers(numbers);
    } catch (error) {
      logger.error('Error loading yearly start numbers:', error);
    }
  };

  const handleAddYearlyStartNumber = async () => {
    try {
      await apiService.createOrUpdateYearlyInvoiceStartNumber(newYear, newStartNumber);
      await loadYearlyStartNumbers();
      setNewYear(new Date().getFullYear() + 1);
      setNewStartNumber(1);
    } catch (error) {
      logger.error('Error adding yearly start number:', error);
    }
  };

  const handleDeleteYearlyStartNumber = async (year: number) => {
    try {
      await apiService.deleteYearlyInvoiceStartNumber(year);
      await loadYearlyStartNumbers();
    } catch (error) {
      logger.error('Error deleting yearly start number:', error);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
      <div className="flex items-center mb-4">
        <FileText className="h-5 w-5 text-primary-custom mr-2" />
        <h3 className="text-lg font-semibold text-gray-900">Rechnungsnummern</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Jährliche Start-Rechnungsnummern
          </label>

          {/* Existing yearly start numbers */}
          <div className="space-y-3 mb-4">
            {yearlyStartNumbers.map((entry) => (
              <div key={entry.year} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-4">
                  <span className="font-medium text-gray-900">{entry.year}</span>
                  <span className="text-gray-600">startet bei {entry.start_number}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteYearlyStartNumber(entry.year)}
                  className="text-red-600 hover:text-red-800 p-1"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          {/* Add new yearly start number */}
          <div className="flex items-end space-x-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700 mb-1">Jahr</label>
              <input
                type="number"
                min="2000"
                max="2100"
                value={newYear}
                onChange={(e) => setNewYear(parseInt(e.target.value) || new Date().getFullYear())}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700 mb-1">Start-Nummer</label>
              <input
                type="number"
                min="1"
                max="9999"
                value={newStartNumber}
                onChange={(e) => setNewStartNumber(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="button"
              onClick={handleAddYearlyStartNumber}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <p className="text-xs text-gray-500 mt-2">
            Definieren Sie spezifische Start-Nummern für bestimmte Jahre. Alle anderen Jahre beginnen automatisch bei 001.
          </p>
        </div>
      </div>
    </div>
  );
}
