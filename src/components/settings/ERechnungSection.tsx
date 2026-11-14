import { Globe } from 'lucide-react';

export function ERechnungSection() {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 lg:p-6">
      <div className="flex items-center mb-4">
        <Globe className="h-5 w-5 text-primary-custom mr-2" />
        <h3 className="text-lg font-semibold text-gray-900">eRechnung Einstellungen</h3>
      </div>

      <div className="space-y-4">
        <div className="bg-primary-custom/10 border border-primary-custom/30 rounded-lg p-4">
          <h4 className="font-medium text-primary-custom mb-2">Unterstützte Formate</h4>
          <ul className="text-sm text-primary-custom space-y-1">
            <li>• <strong>PDF:</strong> Standard PDF-Format für beste Kompatibilität</li>
            <li>• <strong>XRechnung:</strong> Strukturierte XML-Rechnung</li>
          </ul>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h4 className="font-medium text-yellow-900 mb-2">Hinweise</h4>
          <p className="text-sm text-yellow-800">
            Die eRechnung wird ab dem 1. Januar 2025 für alle B2B-Transaktionen in Deutschland Pflicht. 
            Stellen Sie sicher, dass Ihre Firmendaten vollständig und korrekt sind.
          </p>
        </div>
      </div>
    </div>
  );
}
