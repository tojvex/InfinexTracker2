export function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function bucketStart(ts: number, sizeSec: number): number {
  return Math.floor(ts / sizeSec) * sizeSec;
}
