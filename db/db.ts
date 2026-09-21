import 'dotenv/config';
import postgres from '@prisma/orm-postgres/runtime';
import contractJson from './schema' with { type: 'json' };
import type { Contract } from './schema';

export const db = postgres<Contract>({
  contractJson,
  url: process.env['DATABASE_URL']!,
});
