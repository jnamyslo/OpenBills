import React, { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Customer } from '../types';
import { formatCustomerNumber } from '../utils/customerUtils';

interface CustomerSelectProps {
  customers: Customer[];
  value: string;
  onChange: (customerId: string) => void;
  placeholder?: string;
}

const label = (c: Customer) => `${formatCustomerNumber(c.customerNumber)} - ${c.name}`;

/** Kundenauswahl mit Suche (Name, Kundennummer, E-Mail, Ort). */
export function CustomerSelect({ customers: allCustomers, value, onChange, placeholder = 'Kunde suchen…' }: CustomerSelectProps) {
  // Archivierte Kunden nur, wenn sie schon gewählt sind (keine neuen Belege, Backend 409)
  const customers = allCustomers.filter(c => !c.archivedAt || c.id === value);
  const selected = customers.find(c => c.id === value);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  // Eingabefeld zeigt den gewählten Kunden, solange nicht gesucht wird
  const text = open ? query : selected ? label(selected) : '';

  const q = query.trim().toLowerCase();
  const matches = q
    ? customers.filter(c =>
        [label(c), c.email, c.city].some(v => (v || '').toLowerCase().includes(q)))
    : customers;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const choose = (c: Customer) => {
    onChange(c.id);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive(i => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      if (matches[active]) choose(matches[active]);
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation(); // schließt nur die Liste, nicht den Dialog
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
      <input
        type="text"
        value={text}
        placeholder={placeholder}
        onChange={e => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
          if (value) onChange('');
        }}
        onFocus={() => {
          setQuery('');
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
      />
      {open && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto" role="listbox">
          {matches.length > 0 ? (
            matches.map((c, i) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={c.id === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(c)}
                className={`w-full px-3 py-2 text-left border-b border-gray-100 last:border-b-0 ${i === active ? 'bg-blue-50' : 'hover:bg-blue-50'}`}
              >
                <div className="text-sm font-medium text-gray-900">{label(c)}</div>
                {(c.email || c.city) && (
                  <div className="text-xs text-gray-500">{[c.email, c.city].filter(Boolean).join(' · ')}</div>
                )}
              </button>
            ))
          ) : (
            <div className="px-3 py-3 text-sm text-gray-500">Keine Kunden gefunden</div>
          )}
        </div>
      )}
    </div>
  );
}
