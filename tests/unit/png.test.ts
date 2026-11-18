import { expect, it } from 'vitest';
import { pngSize } from '../../src/report/png.js';
import { pngHeader } from '../helpers/png.js';

it('reads width and height from a PNG header', () => {
  expect(pngSize(pngHeader(375, 1200))).toEqual({ width: 375, height: 1200 });
});

it('rejects non-PNG bytes', () => {
  expect(() => pngSize(Buffer.from('hello'))).toThrow(/not a PNG/);
});
