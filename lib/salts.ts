import { query } from './db';
import { createSaltResolver } from './salts.mjs';

/**
 * Typed, database-backed binding of ./salts.mjs. The logic and its explanation
 * live in the .mjs file so it can be unit-tested directly by `node --test`.
 *
 * One lookup per process per UTC day; every other call is a Map read.
 */
const resolver = createSaltResolver((text, params) => query(text, params));

export const getDailySalt: (day: string) => Promise<string> = resolver.getDailySalt;
