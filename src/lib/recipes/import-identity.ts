// Identita' dell'import: la bozza salvata vale solo per lo stesso contenuto importato,
// cosi' una bozza vecchia non sostituisce mai un nuovo import (M13).
export function importIdentity(value: unknown): string {
  const str = JSON.stringify(value) ?? '';
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
