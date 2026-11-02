import * as fs from 'fs';

const TTL = 4000;
const stats = new Map<string, { at: number; mtime?: number }>();

/** Modification time of a file (undefined if it does not exist); results are cached for a few seconds. */
export function mtimeOf(path: string): number | undefined {
  const now = Date.now();
  const cached = stats.get(path);
  if (cached && now - cached.at < TTL) {
    return cached.mtime;
  }
  let mtime: number | undefined;
  try {
    mtime = fs.statSync(path).mtimeMs;
  } catch {
    mtime = undefined;
  }
  stats.set(path, { at: now, mtime });
  return mtime;
}
