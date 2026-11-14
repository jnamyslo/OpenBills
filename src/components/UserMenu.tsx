import { useEffect, useRef, useState } from 'react';
import { ChevronDown, KeyRound, LogOut, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface UserMenuProps {
  onOpenAccount: () => void;
}

export function UserMenu({ onOpenAccount }: UserMenuProps) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (!user) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-md text-gray-700 hover:bg-gray-100 transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <User className="h-5 w-5" />
        <span className="hidden sm:inline text-sm font-medium truncate max-w-[10rem]">{user.name}</span>
        {user.isOperator && (
          <span className="hidden sm:inline text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Support-Zugang</span>
        )}
        <ChevronDown className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-40">
          <div className="px-4 py-2 border-b border-gray-100">
            <p className="text-sm font-medium text-gray-900 truncate">{user.name}</p>
            <p className="text-xs text-gray-500 truncate">{user.email}</p>
            {user.isOperator && <p className="text-xs text-amber-700 mt-1">Support-Zugang</p>}
          </div>
          <button
            role="menuitem"
            onClick={() => { setOpen(false); onOpenAccount(); }}
            className="w-full flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <KeyRound className="h-4 w-4 mr-2" />
            Konto
          </button>
          <button
            role="menuitem"
            onClick={() => { setOpen(false); void logout(); }}
            className="w-full flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Abmelden
          </button>
        </div>
      )}
    </div>
  );
}
