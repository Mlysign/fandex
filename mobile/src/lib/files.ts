// Files on the phone: choosing one to read, and handing one over to save.
// The browser's half is files.web.ts.
//
// ⚠️ Both need native modules (expo-document-picker, expo-file-system,
// expo-sharing), added 2026-10-15. An APK built before that has none of them,
// so a build that predates it must not reach this code: it is only called from
// the import screen and the Settings download, both new in the same build.

import { getDocumentAsync } from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';

export interface PickedFile { name: string; bytes: Uint8Array }

/** Let the person choose files. Null when they cancelled. */
export async function pickFiles(_accept?: string): Promise<PickedFile[] | null> {
  const res = await getDocumentAsync({ type: ['application/zip', 'text/csv', 'text/comma-separated-values', 'application/octet-stream'], multiple: true, copyToCacheDirectory: true });
  if (res.canceled) return null;
  return Promise.all(res.assets.map(async (a) => ({ name: a.name, bytes: await new File(a.uri).bytes() })));
}

/** Hand a JSON file to the system's share sheet, where it can be saved to Files or Drive or sent. */
export async function saveJsonFile(name: string, data: unknown): Promise<void> {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(data, null, 2));
  if (!(await isAvailableAsync())) throw new Error('This phone has nothing to share the file with.');
  await shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: name, UTI: 'public.json' });
}

/** Files dropped on a page: a browser's alone. */
export function readFiles(_list: unknown[]): Promise<PickedFile[]> {
  return Promise.reject(new Error('Dropping files is a browser feature.'));
}
