import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];

vi.mock('../../services/api', () => ({
  apiService: { archiveDocument: vi.fn() },
}));
vi.mock('../pdfGenerator', () => ({
  downloadBlob: vi.fn(() => calls.push('download')),
}));

import { apiService } from '../../services/api';
import { downloadBlob } from '../pdfGenerator';
import { archiveAndDownload, archiveOutput, notArchivedNote } from '../archiveOutput';
import { releaseForOutput } from '../releaseForOutput';

const archiveMock = vi.mocked(apiService.archiveDocument);
const downloadMock = vi.mocked(downloadBlob);
const pdf = () => new Blob(['%PDF-1.7 test'], { type: 'application/pdf' });
const ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  calls.length = 0;
  archiveMock.mockReset();
  archiveMock.mockImplementation(async () => {
    calls.push('archive');
    return { id: 'a1', created: true };
  });
  downloadMock.mockClear();
});

describe('archiveAndDownload', () => {
  it('archiviert vor dem Download', async () => {
    await archiveAndDownload({ id: ID, status: 'sent' }, 'invoice', 'zugferd', pdf(), 'RE-2026-001.pdf');

    expect(calls).toEqual(['archive', 'download']);
    expect(archiveMock).toHaveBeenCalledWith({
      documentType: 'invoice',
      documentId: ID,
      format: 'zugferd',
      filename: 'RE-2026-001.pdf',
      content: btoa('%PDF-1.7 test'),
      source: 'output',
      reminderStage: undefined,
    });
  });

  it('übergibt die Mahnstufe', async () => {
    await archiveAndDownload({ id: ID, status: 'reminded_1x' }, 'reminder', 'pdf', pdf(), 'Mahnung.pdf', 2);
    expect(archiveMock.mock.calls[0][0]).toMatchObject({ documentType: 'reminder', reminderStage: 2 });
  });

  it('archiviert Entwürfe nicht, lädt sie aber herunter', async () => {
    await archiveAndDownload({ id: ID, status: 'draft' }, 'quote', 'pdf', pdf(), 'AN-2026-001.pdf');
    expect(archiveMock).not.toHaveBeenCalled();
    expect(calls).toEqual(['download']);
  });

  it('bricht den Download ab, wenn das Archivieren scheitert', async () => {
    archiveMock.mockRejectedValueOnce(new Error('offline'));
    await expect(
      archiveAndDownload({ id: ID, status: 'sent' }, 'invoice', 'zugferd', pdf(), 'RE.pdf')
    ).rejects.toThrow('offline');
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('setzt mit releaseForOutput den Entwurf zurück, wenn das Archivieren scheitert', async () => {
    archiveMock.mockRejectedValueOnce(new Error('offline'));
    const setStatus = vi.fn(async () => undefined);

    await expect(
      releaseForOutput({ id: ID, status: 'draft' }, setStatus, released =>
        archiveAndDownload(released, 'invoice', 'zugferd', pdf(), 'RE.pdf')
      )
    ).rejects.toThrow('offline');

    expect(setStatus.mock.calls).toEqual([['sent'], ['draft']]);
    expect(archiveMock).toHaveBeenCalledTimes(1);
    expect(downloadMock).not.toHaveBeenCalled();
  });
});

describe('archiveOutput', () => {
  it('meldet, ob archiviert wurde', async () => {
    expect(await archiveOutput({ id: ID, status: 'paid' }, 'invoice', 'xrechnung', pdf(), 'x.xml', undefined, 'regenerated')).toBe(true);
    expect(archiveMock.mock.calls[0][0]).toMatchObject({ source: 'regenerated' });
    expect(await archiveOutput({ id: ID, status: 'draft' }, 'invoice', 'pdf', pdf(), 'x.pdf')).toBe(false);
  });
});

describe('notArchivedNote', () => {
  it('ist leer, wenn alles archiviert wurde', () => {
    expect(notArchivedNote(0)).toBe('');
  });
  it('warnt bei nicht archivierten Belegen', () => {
    expect(notArchivedNote(1)).toContain('Versendet, aber nicht archiviert');
    expect(notArchivedNote(3)).toContain('3 Belege');
  });
});
