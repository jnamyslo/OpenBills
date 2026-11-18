import React, { useState } from 'react';
import { Plus, Edit } from 'lucide-react';
import { Customer } from '../types';
import { formatCustomerNumber } from '../utils/customerUtils';
import { DiscountCalculation, formatDiscountDisplay } from '../utils/discountUtils';

/**
 * Gemeinsame Bausteine für Rechnung, Angebot und Auftrag,
 * damit alle Belegformulare gleich aufgebaut sind.
 */

export const fieldInputClass =
  'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';
export const fieldLabelClass = 'block text-sm font-medium text-gray-700 mb-1';

export function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
      {children}
    </div>
  );
}

const customerLabel = (customer: Customer) =>
  `${formatCustomerNumber(customer.customerNumber)} - ${customer.name}`;

interface CustomerPickerProps {
  customers: Customer[];
  selectedId: string;
  onSelect: (customer: Customer | null) => void;
  onCreateNew: () => void;
}

/** Kundensuche mit Dropdown und Button „Neuen Kunden anlegen“. */
export function CustomerPicker({ customers: allCustomers, selectedId, onSelect, onCreateNew }: CustomerPickerProps) {
  // Archivierte Kunden nur, wenn der Beleg schon zu ihnen gehört (keine neuen Belege, Backend 409)
  const customers = allCustomers.filter(c => !c.archivedAt || c.id === selectedId);
  // null = Anzeige folgt dem ausgewählten Kunden; String = laufende Suche
  const [searchTerm, setSearchTerm] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const selected = customers.find(c => c.id === selectedId);
  const displayValue = searchTerm ?? (selected ? customerLabel(selected) : '');
  const term = (searchTerm ?? '').toLowerCase();
  const filtered = customers.filter(customer =>
    customer.name.toLowerCase().includes(term) ||
    (customer.customerNumber || '').toLowerCase().includes(term) ||
    (customer.email || '').toLowerCase().includes(term)
  );

  return (
    <div>
      <label className={fieldLabelClass}>Kunde *</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 relative">
          <input
            type="text"
            value={displayValue}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setIsOpen(true);
              if (!e.target.value) onSelect(null);
            }}
            onFocus={() => setIsOpen(true)}
            onBlur={() => setTimeout(() => {
              setIsOpen(false);
              setSearchTerm(null);
            }, 200)}
            placeholder="Kunde suchen oder auswählen..."
            className={fieldInputClass}
            required
          />
          {isOpen && (
            <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
              {filtered.length > 0 ? (
                filtered.map(customer => (
                  <button
                    key={customer.id}
                    type="button"
                    onClick={() => {
                      onSelect(customer);
                      setSearchTerm(null);
                      setIsOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none border-b border-gray-100 last:border-b-0"
                  >
                    <div className="font-medium text-sm break-words">{customerLabel(customer)}</div>
                    {customer.email && (
                      <div className="text-xs text-gray-500 break-words">{customer.email}</div>
                    )}
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-gray-500 text-sm">Keine Kunden gefunden</div>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onCreateNew}
          className="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors flex items-center justify-center text-sm sm:w-auto w-full"
          title="Neuen Kunden anlegen"
        >
          <Plus className="h-4 w-4 mr-2 sm:mr-0" />
          <span className="sm:hidden">Neuen Kunden anlegen</span>
        </button>
      </div>
    </div>
  );
}

export interface TemplateGroup {
  label: string;
  options: { value: string; label: string }[];
}

interface TemplateAddBarProps {
  groups: TemplateGroup[];
  onSelect: (value: string) => void;
  onAddManual: () => void;
  onManage?: () => void;
  manageTitle?: string;
}

/** „Aus Vorlage“-Auswahl plus „Manuell hinzufügen“ über der Positionsliste. */
export function TemplateAddBar({ groups, onSelect, onAddManual, onManage, manageTitle = 'Stundensätze und Materialien verwalten' }: TemplateAddBarProps) {
  const visibleGroups = groups.filter(group => group.options.length > 0);
  return (
    <div className="flex flex-col gap-3 mb-4">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <label className="text-sm text-gray-600 sm:whitespace-nowrap">Aus Vorlage:</label>
        <div className="flex gap-2 flex-1">
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) onSelect(e.target.value);
            }}
            className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          >
            <option value="">{visibleGroups.length > 0 ? 'Vorlage wählen...' : 'Keine Vorlagen vorhanden'}</option>
            {visibleGroups.map(group => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {onManage && (
            <button
              type="button"
              onClick={onManage}
              className="p-2 text-blue-600 hover:text-blue-800 border border-gray-300 rounded-lg hover:bg-blue-50 transition-colors flex-shrink-0"
              title={manageTitle}
            >
              <Edit className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onAddManual}
        className="btn-primary px-4 py-2 rounded-lg flex items-center justify-center space-x-2 transition-colors w-full sm:w-auto sm:self-start"
      >
        <Plus className="h-4 w-4" />
        <span>Manuell hinzufügen</span>
      </button>
    </div>
  );
}

interface GlobalDiscountSectionProps {
  type?: 'percentage' | 'fixed';
  value?: number;
  amount: number;
  onChange: (discount: { type?: 'percentage' | 'fixed'; value?: number }) => void;
  hint?: string;
}

export function GlobalDiscountSection({ type, value, amount, onChange, hint }: GlobalDiscountSectionProps) {
  return (
    <FormSection title="Gesamtrabatt">
      <div className="grid grid-cols-1 gap-4">
        <div>
          <label className={fieldLabelClass}>Rabatttyp</label>
          <select
            value={type || ''}
            onChange={(e) => {
              const newType = (e.target.value || undefined) as 'percentage' | 'fixed' | undefined;
              onChange({ type: newType, value: newType ? value : undefined });
            }}
            className={fieldInputClass}
          >
            <option value="">Kein Gesamtrabatt</option>
            <option value="percentage">Prozentual (%)</option>
            <option value="fixed">Festbetrag (€)</option>
          </select>
        </div>

        <div>
          <label className={fieldLabelClass}>Rabattwert</label>
          <div className="flex">
            <input
              type="number"
              min="0"
              max={type === 'percentage' ? '100' : undefined}
              step="0.01"
              value={value ?? ''}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '' || !isNaN(parseFloat(raw))) {
                  onChange({ type, value: raw === '' ? undefined : parseFloat(raw) });
                }
              }}
              disabled={!type}
              placeholder="0"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 min-w-0"
            />
            <div className="px-3 py-2 bg-gray-100 border border-l-0 border-gray-300 rounded-r-lg text-gray-600 text-sm flex items-center flex-shrink-0">
              {type === 'percentage' ? '%' : '€'}
            </div>
          </div>
        </div>

        <div>
          <label className={fieldLabelClass}>Rabattbetrag</label>
          <div className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 font-medium">
            €{(amount || 0).toFixed(2)}
          </div>
        </div>
      </div>

      {type && value ? (
        <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800">
            <strong>Gesamtrabatt:</strong> {formatDiscountDisplay(type, value, amount)}
          </p>
        </div>
      ) : null}
      {hint && <p className="mt-3 text-xs text-gray-500">{hint}</p>}
    </FormSection>
  );
}

interface DocumentTotalsProps {
  totals: DiscountCalculation;
  discountsEnabled: boolean;
  isSmallBusiness: boolean;
  children?: React.ReactNode;
}

export function DocumentTotals({ totals, discountsEnabled, isSmallBusiness, children }: DocumentTotalsProps) {
  const { subtotal, itemDiscountAmount, globalDiscountAmount, totalDiscountAmount, discountedSubtotal, taxAmount, taxBreakdown, total, hasOnlyZeroTax } = totals;
  const taxRates = Object.entries(taxBreakdown)
    .filter(([rate]) => Number(rate) > 0)
    .sort(([a], [b]) => Number(a) - Number(b));

  return (
    <FormSection title="Gesamtsumme">
      <div className="space-y-2 text-sm sm:text-base">
        {children}
        <div className="flex justify-between">
          <span className="text-gray-600">Zwischensumme:</span>
          <span className="font-medium">€{subtotal.toFixed(2)}</span>
        </div>

        {discountsEnabled && itemDiscountAmount > 0 && (
          <div className="flex justify-between text-red-600">
            <span>Artikelrabatte:</span>
            <span>-€{itemDiscountAmount.toFixed(2)}</span>
          </div>
        )}

        {discountsEnabled && globalDiscountAmount > 0 && (
          <div className="flex justify-between text-red-600">
            <span>Gesamtrabatt:</span>
            <span>-€{globalDiscountAmount.toFixed(2)}</span>
          </div>
        )}

        {discountsEnabled && (itemDiscountAmount > 0 || globalDiscountAmount > 0) && (
          <div className="flex justify-between border-t pt-2">
            <span className="text-gray-600">Zwischensumme nach Rabatt:</span>
            <span className="font-medium">€{discountedSubtotal.toFixed(2)}</span>
          </div>
        )}

        {taxRates.map(([rate, breakdown]) => (
          <div key={rate} className="flex justify-between">
            <span className="text-gray-600">MwSt. ({rate}%):</span>
            <span className="font-medium">€{breakdown.taxAmount.toFixed(2)}</span>
          </div>
        ))}

        {taxRates.length > 1 && (
          <div className="flex justify-between text-sm border-t pt-1 mt-1">
            <span className="text-gray-600">MwSt. gesamt:</span>
            <span className="font-medium">€{taxAmount.toFixed(2)}</span>
          </div>
        )}

        <div className="flex justify-between text-lg font-bold border-t pt-2">
          <span>Gesamtbetrag:</span>
          <span>€{total.toFixed(2)}</span>
        </div>

        {totalDiscountAmount > 0 && (
          <div className="flex justify-between text-sm text-green-600 border-t pt-2">
            <span>Gesamtersparnis:</span>
            <span className="font-medium">€{totalDiscountAmount.toFixed(2)}</span>
          </div>
        )}

        {hasOnlyZeroTax && (
          <div className="border-t pt-3 mt-3">
            <p className="text-sm font-bold text-gray-900 text-center">
              {isSmallBusiness
                ? 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung)'
                : 'Gemäß § 13b UStG geht die Steuerschuld auf den Leistungsempfänger über'}
            </p>
          </div>
        )}
      </div>
    </FormSection>
  );
}
