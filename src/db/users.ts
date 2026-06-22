import { db } from './index.ts';
import { users } from './schema.ts';

/**
 * Safely registers or updates a user in PostgreSQL using Drizzle upsert.
 */
export async function getOrCreateUser(uid: string, mobile: string, displayName?: string) {
  try {
    const result = await db.insert(users)
      .values({
        uid,
        mobile,
        displayName: displayName || null,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          mobile,
          displayName: displayName || null,
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error("Database user upsert failed:", error);
    throw new Error("Failed to register or sync user profile in database.", { cause: error });
  }
}
