import { InputHTMLAttributes, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { wrapperClassName?: string };

/** Passwortfeld mit Auge-Icon zum Ein-/Ausblenden der Eingabe. */
export function PasswordInput({ className = '', wrapperClassName = '', ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;
  return (
    <div className={`relative ${wrapperClassName}`}>
      <input {...props} type={visible ? 'text' : 'password'} className={`${className} block pr-10`} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Passwort verbergen' : 'Passwort anzeigen'}
        aria-pressed={visible}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-500 hover:text-gray-700"
      >
        <Icon className="h-4 w-4" />
      </button>
    </div>
  );
}
