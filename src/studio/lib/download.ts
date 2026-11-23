export function downloadBytes(name: string, bytes: Uint8Array | string, type = "application/octet-stream"): void {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function dataUrlBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(",")[1] ?? "";
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function bytesToDataUrl(bytes: Uint8Array, type: string): string {
  return `data:${type};base64,${bytesToBase64(bytes)}`;
}

// Saves bytes with the native "Save as" dialog when the browser has one, else a download.
export async function saveBytes(name: string, bytes: Uint8Array, type: string): Promise<"saved" | "downloaded" | "cancelled"> {
  const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }> };
  if (typeof w.showSaveFilePicker === "function") {
    try {
      const ext = name.split(".").pop() ?? "";
      const handle = await w.showSaveFilePicker({ suggestedName: name, types: [{ description: ext.toUpperCase(), accept: { [type]: [`.${ext}`] } }] });
      const out = await handle.createWritable();
      await out.write(new Blob([bytes as BlobPart], { type }));
      await out.close();
      return "saved";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
    }
  }
  downloadBytes(name, bytes, type);
  return "downloaded";
}
