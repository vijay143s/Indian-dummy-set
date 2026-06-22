import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

// Create a Postgres connection
const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/indiandummyset";
const client = postgres(connectionString);

export const db = drizzle(client, { schema });

// Export type for use in other files
export type DbType = typeof db;
export * as schema from './schema.ts';
