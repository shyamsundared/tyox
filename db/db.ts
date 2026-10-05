import dotenv from 'dotenv';
import { resolve } from 'node:path';
import postgres from '@prisma/orm-postgres/runtime';
import contractJson from './schema' with { type: 'json' };
import type { Contract } from './schema';

// Resolve the local DB settings relative to this file, not process.cwd().
dotenv.config({ path: resolve(import.meta.dir, '.env') });

export const db = postgres<Contract>({
  contractJson,
  url: process.env['DATABASE_URL']!,
});
