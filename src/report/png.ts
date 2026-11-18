import { UilintError } from '../errors.js';

/** Screenshots stop here: taller pages are cut, and findings below get a wireframe. */
export const MAX_SCREENSHOT_HEIGHT = 10000;

/** Page expression for the document's full size, used by adapters to size the screenshot clip. */
export const SCROLL_SIZE = '[document.documentElement.scrollWidth, document.documentElement.scrollHeight]';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Reads the pixel size from the IHDR chunk. */
export function pngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || !SIGNATURE.every((b, i) => png[i] === b) || png.toString('ascii', 12, 16) !== 'IHDR') {
    throw new UilintError('not a PNG');
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
