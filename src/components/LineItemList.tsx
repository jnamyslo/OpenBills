import { ChevronUp, ChevronDown, GripVertical, Trash2, Calculator } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatDiscountDisplay } from '../utils/discountUtils';

/** Gemeinsame Sicht auf eine Position (Rechnung, Angebot, Auftrag). */
export interface LineItem {
  id: string;
  description: string;
  /** '' nur während der Eingabe (Feld geleert), beim Verlassen wird 0 gesetzt */
  quantity: number | '';
  unitPrice: number | '';
  taxRate: number;
  discountType?: 'percentage' | 'fixed';
  discountValue?: number;
  discountAmount?: number;
}

export type LineItemField = 'description' | 'quantity' | 'unitPrice' | 'taxRate' | 'discountType' | 'discountValue';
export type LineItemValue = string | number | undefined;

const TAX_RATES = [0, 7, 19];

const inputClass =
  'w-full px-3 py-2 lg:px-2 lg:py-1.5 text-sm border border-gray-300 rounded-lg lg:rounded focus:outline-none focus:ring-1 focus:ring-blue-500';
const labelClass = 'block text-xs font-medium text-gray-700 mb-1';

interface RowProps {
  item: LineItem;
  onUpdate: (id: string, field: LineItemField, value: LineItemValue) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  isFirst: boolean;
  isLast: boolean;
  isSmallBusiness: boolean;
  discountsEnabled: boolean;
  quantityLabel: string;
  priceLabel: string;
  priceReadOnly: boolean;
}

function NumberInput({
  value,
  onChange,
  onEmptyBlur,
  required,
  disabled,
  readOnly,
  placeholder,
  className = inputClass,
}: {
  value: number | '' | undefined;
  onChange: (value: number | '') => void;
  onEmptyBlur?: () => void;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type="number"
      min="0"
      step="0.01"
      required={required}
      disabled={disabled}
      readOnly={readOnly}
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '' || !isNaN(parseFloat(raw))) {
          onChange(raw === '' ? '' : parseFloat(raw));
        }
      }}
      onBlur={(e) => {
        if (e.target.value === '') onEmptyBlur?.();
      }}
      className={className}
    />
  );
}

function SortableLineItemRow({
  item,
  onUpdate,
  onRemove,
  onMove,
  isFirst,
  isLast,
  isSmallBusiness,
  discountsEnabled,
  quantityLabel,
  priceLabel,
  priceReadOnly,
}: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const quantity = Number(item.quantity) || 0;
  const unitPrice = Number(item.unitPrice) || 0;
  const gross = quantity * unitPrice;
  const discountAmount = item.discountAmount || 0;
  const taxRates = !isSmallBusiness && !TAX_RATES.includes(item.taxRate) ? [...TAX_RATES, item.taxRate].sort((a, b) => a - b) : TAX_RATES;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`border border-gray-200 rounded-lg p-3 bg-white ${isDragging ? 'shadow-lg' : ''}`}
    >
      <div className="grid grid-cols-6 lg:grid-cols-12 gap-3 items-end">
        <div className={`col-span-6 ${discountsEnabled ? 'lg:col-span-4' : 'lg:col-span-6'}`}>
          <label className={labelClass}>Beschreibung *</label>
          <input
            type="text"
            required
            value={item.description}
            onChange={(e) => onUpdate(item.id, 'description', e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="col-span-2 lg:col-span-1">
          <label className={labelClass}>{quantityLabel} *</label>
          <NumberInput
            required
            value={item.quantity}
            onChange={(v) => onUpdate(item.id, 'quantity', v)}
            onEmptyBlur={() => onUpdate(item.id, 'quantity', 0)}
          />
        </div>

        <div className="col-span-2 lg:col-span-1">
          <label className={labelClass}>{priceLabel} *</label>
          <NumberInput
            required
            readOnly={priceReadOnly}
            value={item.unitPrice}
            onChange={(v) => onUpdate(item.id, 'unitPrice', v)}
            onEmptyBlur={() => onUpdate(item.id, 'unitPrice', 0)}
            className={`${inputClass} ${priceReadOnly ? 'bg-gray-100' : ''}`}
          />
        </div>

        <div className="col-span-2 lg:col-span-1">
          <label className={labelClass}>MwSt.</label>
          <select
            value={isSmallBusiness ? 0 : item.taxRate}
            onChange={(e) => onUpdate(item.id, 'taxRate', parseFloat(e.target.value))}
            disabled={isSmallBusiness}
            title={isSmallBusiness ? 'MwSt. durch Kleinunternehmerregelung deaktiviert' : undefined}
            className={`${inputClass} ${isSmallBusiness ? 'bg-gray-100 cursor-not-allowed' : ''}`}
          >
            {(isSmallBusiness ? [0] : taxRates).map(rate => (
              <option key={rate} value={rate}>{rate}%</option>
            ))}
          </select>
        </div>

        {discountsEnabled && (
          <div className="col-span-3 lg:col-span-2">
            <label className={labelClass}>Rabatt</label>
            <div className="flex">
              <select
                value={item.discountType || ''}
                onChange={(e) => {
                  const discountType = e.target.value as 'percentage' | 'fixed' | '';
                  onUpdate(item.id, 'discountType', discountType || undefined);
                  if (!discountType) onUpdate(item.id, 'discountValue', undefined);
                }}
                className="w-12 px-1 py-2 lg:py-1.5 text-xs border border-gray-300 rounded-l-lg lg:rounded-l focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">-</option>
                <option value="percentage">%</option>
                <option value="fixed">€</option>
              </select>
              <NumberInput
                disabled={!item.discountType}
                placeholder="0"
                value={item.discountValue}
                onChange={(v) => onUpdate(item.id, 'discountValue', v === '' ? undefined : v)}
                className="flex-1 min-w-0 px-2 py-2 lg:py-1.5 text-sm border border-l-0 border-gray-300 rounded-r-lg lg:rounded-r focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
              />
            </div>
          </div>
        )}

        <div className={`${discountsEnabled ? 'col-span-3' : 'col-span-6'} lg:col-span-2`}>
          <label className={labelClass}>Summe</label>
          <div
            className="text-sm font-medium text-gray-900 py-2 lg:py-1.5 px-2 bg-gray-50 border border-gray-200 rounded-lg lg:rounded truncate"
            title={discountAmount > 0 && item.discountType && item.discountValue
              ? `€${gross.toFixed(2)} − ${formatDiscountDisplay(item.discountType, item.discountValue, discountAmount)}`
              : undefined}
          >
            €{(gross - discountAmount).toFixed(2)}
          </div>
        </div>

        <div className="col-span-6 lg:col-span-1 flex items-center justify-between lg:justify-center gap-1 pt-2 lg:pt-0 border-t border-gray-100 lg:border-t-0">
          <div className="flex items-center gap-1 lg:gap-0">
            <button
              type="button"
              {...attributes}
              {...listeners}
              className="text-gray-400 hover:text-gray-600 p-2 lg:p-1 cursor-grab active:cursor-grabbing touch-none"
              title="Ziehen zum Verschieben"
            >
              <GripVertical className="h-4 w-4 lg:h-3 lg:w-3" />
            </button>
            <button
              type="button"
              onClick={() => onMove(item.id, -1)}
              disabled={isFirst}
              className="text-gray-400 hover:text-gray-600 p-2 lg:p-1 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Nach oben"
            >
              <ChevronUp className="h-4 w-4 lg:h-3 lg:w-3" />
            </button>
            <button
              type="button"
              onClick={() => onMove(item.id, 1)}
              disabled={isLast}
              className="text-gray-400 hover:text-gray-600 p-2 lg:p-1 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Nach unten"
            >
              <ChevronDown className="h-4 w-4 lg:h-3 lg:w-3" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            className="text-red-600 hover:text-red-900 p-2 lg:p-1"
            title="Löschen"
          >
            <Trash2 className="h-4 w-4 lg:h-3 lg:w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface LineItemListProps {
  items: LineItem[];
  onUpdate: (id: string, field: LineItemField, value: LineItemValue) => void;
  onRemove: (id: string) => void;
  /** Position von fromIndex nach toIndex verschieben */
  onReorder: (fromIndex: number, toIndex: number) => void;
  isSmallBusiness: boolean;
  discountsEnabled: boolean;
  quantityLabel?: string;
  priceLabel?: string;
  priceReadOnly?: boolean;
  emptyText?: string;
}

/** Sortierbare Positionsliste im Layout des Rechnungsformulars. */
export function LineItemList({
  items,
  onUpdate,
  onRemove,
  onReorder,
  isSmallBusiness,
  discountsEnabled,
  quantityLabel = 'Menge',
  priceLabel = 'Preis',
  priceReadOnly = false,
  emptyText = 'Keine Positionen hinzugefügt. Wählen Sie eine Vorlage oder fügen Sie eine Position manuell hinzu.',
}: LineItemListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = items.findIndex(item => item.id === active.id);
    const to = items.findIndex(item => item.id === over.id);
    if (from >= 0 && to >= 0) onReorder(from, to);
  };

  const handleMove = (id: string, direction: -1 | 1) => {
    const from = items.findIndex(item => item.id === id);
    const to = from + direction;
    if (from >= 0 && to >= 0 && to < items.length) onReorder(from, to);
  };

  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <Calculator className="h-12 w-12 mx-auto mb-4 text-gray-400" />
        <p>{emptyText}</p>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-4">
          {items.map((item, index) => (
            <SortableLineItemRow
              key={item.id}
              item={item}
              onUpdate={onUpdate}
              onRemove={onRemove}
              onMove={handleMove}
              isFirst={index === 0}
              isLast={index === items.length - 1}
              isSmallBusiness={isSmallBusiness}
              discountsEnabled={discountsEnabled}
              quantityLabel={quantityLabel}
              priceLabel={priceLabel}
              priceReadOnly={priceReadOnly}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
