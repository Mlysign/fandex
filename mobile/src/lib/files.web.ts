// Files in a browser: an <input type="file"> and a download link. The phone's
// half is files.ts.

export interface PickedFile { name: string; bytes: Uint8Array }

/** Let the person choose files. Null when they closed the picker without choosing. */
export function pickFiles(accept = '.zip,.csv'): Promise<PickedFile[] | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = true;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const list = [...(input.files ?? [])];
      input.remove();
      if (!list.length) { resolve(null); return; }
      readFiles(list).then(resolve, reject);
    });
    input.addEventListener('cancel', () => { input.remove(); resolve(null); });
    document.body.appendChild(input);
    input.click();
  });
}

/** Files dropped on the page, or chosen some other way. */
export function readFiles(list: File[]): Promise<PickedFile[]> {
  return Promise.all(list.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
}

/** Download a JSON file. */
export async function saveJsonFile(name: string, data: unknown): Promise<void> {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
