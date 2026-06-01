import { eq } from "drizzle-orm"

import { db } from "../index"
import { usersTable } from "../schema"

export class UsersRepository {
  /**
   * Look up a user by id, returning the id and authorization role.
   * Returns undefined when the user does not exist.
   */
  async getById(
    userId: string,
  ): Promise<{ id: string; role: string } | undefined> {
    const [user] = await db
      .select({ id: usersTable.id, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, userId))

    return user
  }

  /**
   * Authoritative admin check, read from the database rather than trusting any
   * client-supplied value. Fails closed: a missing user is not an admin.
   */
  async isAdmin(userId: string | null | undefined): Promise<boolean> {
    if (!userId) return false
    const user = await this.getById(userId)
    return user?.role === "admin"
  }
}

export const usersRepository = new UsersRepository()
