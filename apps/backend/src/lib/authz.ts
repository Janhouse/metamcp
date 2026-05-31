import { usersRepository } from "../db/repositories/users.repo"

/**
 * Resolve the owner (`user_id`) for a create/update operation where the client
 * may have supplied an explicit owner.
 *
 * Security: only admins may assign a resource to another user or to "public"
 * (`user_id = null`). A non-admin caller can only ever own the resources it
 * creates/updates, regardless of what `user_id` it sends. This closes the
 * cross-tenant ownership mass-assignment IDOR: a regular user can no longer
 * mint/transfer resources for a victim or publish a resource to everyone.
 *
 * @param requestedUserId client-supplied owner: a user id, `null` for public,
 *                        or `undefined` when the client did not specify one.
 * @param requesterId     the authenticated caller's user id.
 * @param fallback        owner to use when the client did not supply one and
 *                        when a non-admin attempts to override it. Defaults to
 *                        the requester (correct for create); pass the existing
 *                        owner for update so a non-admin cannot change it.
 */
export async function resolveOwnerUserId(
  requestedUserId: string | null | undefined,
  requesterId: string,
  fallback: string | null = requesterId,
): Promise<string | null> {
  // No explicit owner requested → keep the fallback (self for create, existing
  // owner for update). No admin lookup needed.
  if (requestedUserId === undefined) {
    return fallback
  }

  // An explicit owner (or public) was requested; only admins may honor it.
  if (await usersRepository.isAdmin(requesterId)) {
    return requestedUserId
  }

  // Non-admins cannot reassign ownership: scope to the fallback.
  return fallback
}

/**
 * Authorization check for mutating/deleting an existing resource.
 *
 * A caller may manage a resource only if they own it, or they are an admin.
 * In particular, public/shared resources (`user_id = null`) are NOT
 * world-writable: only an admin may modify or delete them. This closes the
 * "any authenticated user can update/delete public servers, namespaces,
 * endpoints and API keys" issue.
 */
export async function canManageResource(
  resourceUserId: string | null,
  requesterId: string,
): Promise<boolean> {
  if (resourceUserId !== null && resourceUserId === requesterId) {
    return true
  }
  return usersRepository.isAdmin(requesterId)
}

/**
 * Authorization check for reading/using an existing resource (as opposed to
 * managing it). Public resources (`user_id = null`) are usable by everyone;
 * private resources only by their owner or an admin. Used to gate which
 * namespace a caller may open a proxy session against.
 */
export async function canAccessResource(
  resourceUserId: string | null,
  requesterId: string,
): Promise<boolean> {
  if (resourceUserId === null) return true // public → usable by all
  if (resourceUserId === requesterId) return true
  return usersRepository.isAdmin(requesterId)
}
