import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema.ts';

// Create a local SQLite database
const sqlite = new Database('sqlite.db');

export const db = drizzle(sqlite, { schema });

// Export type for use in other files
export type DbType = typeof db;
export * as schema from './schema.ts';
