import { UilintError } from '../errors.js';
import type { CreateDriver } from '../types.js';

/** Placeholder until the BetterWright adapter lands (Task 14). */
export const createBetterWrightDriver: CreateDriver = async () => {
  throw new UilintError('the betterwright driver is not available yet');
};
export const createDriver = createBetterWrightDriver;
