const STORAGE_PREFIX = "carboncode.";
const LEGACY_STORAGE_PREFIX = "rx.";

export function readDashboardStorage(key: string): string | null {
  const currentKey = `${STORAGE_PREFIX}${key}`;
  const current = localStorage.getItem(currentKey);
  if (current !== null) return current;

  const legacy = localStorage.getItem(`${LEGACY_STORAGE_PREFIX}${key}`);
  if (legacy === null) return null;

  try {
    localStorage.setItem(currentKey, legacy);
  } catch {
    // Reading legacy state is still useful when storage is read-only.
  }
  return legacy;
}

export function writeDashboardStorage(key: string, value: string): void {
  localStorage.setItem(`${STORAGE_PREFIX}${key}`, value);
}
