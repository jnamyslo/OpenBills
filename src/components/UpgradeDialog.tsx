import { X, Sparkles, Mail, Phone, ExternalLink } from 'lucide-react';
import { PlanInfo } from '../types';

interface UpgradeDialogProps {
  message: string;
  plan: PlanInfo | null;
  onClose: () => void;
}

/** Kontakt als Link: E-Mail → mailto, URL → https, sonst Telefon. */
function contactLink(contact: string): { href: string; icon: typeof Mail } {
  if (contact.includes('@') && !contact.includes('://')) return { href: `mailto:${contact}`, icon: Mail };
  if (/^https?:\/\//i.test(contact)) return { href: contact, icon: ExternalLink };
  return { href: `tel:${contact.replace(/[^\d+]/g, '')}`, icon: Phone };
}

export function UpgradeDialog({ message, plan, onClose }: UpgradeDialogProps) {
  const contact = plan?.upgradeContact;
  const link = contact ? contactLink(contact) : null;
  const ContactIcon = link?.icon;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between p-4 lg:p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-full bg-amber-100">
              <Sparkles className="h-5 w-5 text-amber-600" />
            </div>
            <h3 className="text-base lg:text-lg font-semibold text-gray-900">Tarif upgraden</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Schließen">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 lg:p-6 space-y-4">
          <p className="text-sm text-gray-700">{message}</p>
          {plan && (
            <p className="text-sm text-gray-500">
              Aktueller Tarif: <strong className="text-gray-900">{plan.label}</strong>
            </p>
          )}
          {link && ContactIcon ? (
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-sm text-gray-700 mb-2">Für ein Upgrade kontaktieren Sie uns:</p>
              <a
                href={link.href}
                target={link.href.startsWith('http') ? '_blank' : undefined}
                rel="noopener noreferrer"
                className="inline-flex items-center text-sm font-medium text-primary-custom hover:underline break-all"
              >
                <ContactIcon className="h-4 w-4 mr-2 flex-shrink-0" />
                {contact}
              </a>
            </div>
          ) : (
            <p className="text-sm text-gray-700">Für ein Upgrade wenden Sie sich bitte an Ihren Anbieter.</p>
          )}
        </div>

        <div className="flex justify-end p-4 lg:p-6 border-t border-gray-200">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
