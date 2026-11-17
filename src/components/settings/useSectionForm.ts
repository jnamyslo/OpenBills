import { Dispatch, SetStateAction, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useCompany } from '../../context/CompanyContext';
import logger from '../../utils/logger';
import type { Company } from '../../types';
import { isSectionDirty, mergeSectionFields } from './sections';
import { SettingsDirtyContext } from './SettingsDirtyContext';

export type SaveStatus = 'idle' | 'saved' | 'error';

export interface SectionForm {
  /** Arbeitskopie der gesamten Firma; gespeichert werden nur die Bereichsfelder. */
  formData: Company;
  setFormData: Dispatch<SetStateAction<Company>>;
  dirty: boolean;
  saving: boolean;
  status: SaveStatus;
  save: () => Promise<boolean>;
  discard: () => void;
}

/**
 * Formular-Zustand eines Einstellungsbereichs mit eigenem Speichern.
 * Speichert `company` (Stand zum Speicherzeitpunkt) plus nur die eigenen Felder,
 * damit ein Bereich nie die gespeicherten Werte eines anderen überschreibt.
 */
export function useSectionForm(fields: (keyof Company)[]): SectionForm {
  const { company, updateCompany } = useCompany();
  const { setDirty } = useContext(SettingsDirtyContext);
  const [formData, setFormData] = useState<Company>(company);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const dirty = isSectionDirty(company, formData, fields);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Neuer gespeicherter Stand (z. B. aus anderem Bereich) übernehmen, solange hier nichts offen ist.
  useEffect(() => {
    if (!dirtyRef.current) setFormData(company);
  }, [company]);

  useEffect(() => {
    setDirty(dirty);
  }, [dirty, setDirty]);

  useEffect(() => () => setDirty(false), [setDirty]);

  useEffect(() => {
    if (status !== 'saved') return;
    const timer = setTimeout(() => setStatus('idle'), 3000);
    return () => clearTimeout(timer);
  }, [status]);

  const save = useCallback(async () => {
    setSaving(true);
    setStatus('idle');
    try {
      const merged = mergeSectionFields(company, formData, fields);
      await updateCompany(merged);
      dirtyRef.current = false;
      setFormData(merged);
      setStatus('saved');
      return true;
    } catch (error) {
      logger.error('Error saving settings:', error);
      setStatus('error');
      return false;
    } finally {
      setSaving(false);
    }
  }, [company, formData, fields, updateCompany]);

  const discard = useCallback(() => {
    setFormData(company);
    setStatus('idle');
  }, [company]);

  return { formData, setFormData, dirty, saving, status, save, discard };
}
