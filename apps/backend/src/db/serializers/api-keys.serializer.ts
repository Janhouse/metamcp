/**
 * Mask an API key to a non-secret hint (e.g. "sk_mt_…AB12"). Used when listing
 * keys the requester does not own so the full secret is never disclosed.
 */
export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 10) return "••••";
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

export class ApiKeysSerializer {
  static serializeApiKey(dbApiKey: {
    uuid: string;
    name: string;
    key: string;
    created_at: Date;
    is_active: boolean;
  }) {
    return {
      uuid: dbApiKey.uuid,
      name: dbApiKey.name,
      key: dbApiKey.key,
      created_at: dbApiKey.created_at,
      is_active: dbApiKey.is_active,
    };
  }

  static serializeApiKeyList(
    dbApiKeys: Array<{
      uuid: string;
      name: string;
      key: string;
      created_at: Date;
      is_active: boolean;
      user_id: string | null;
    }>,
    options: { requesterId?: string; isAdmin?: boolean } = {},
  ) {
    const { requesterId, isAdmin = false } = options;
    return dbApiKeys.map((apiKey) => {
      // Full secret only for the owner or an admin. Public/shared keys
      // (user_id = null) are admin-managed and masked for everyone else.
      const canSeeSecret =
        isAdmin || (apiKey.user_id !== null && apiKey.user_id === requesterId);
      return {
        uuid: apiKey.uuid,
        name: apiKey.name,
        key: canSeeSecret ? apiKey.key : maskApiKey(apiKey.key),
        created_at: apiKey.created_at,
        is_active: apiKey.is_active,
        user_id: apiKey.user_id,
      };
    });
  }

  static serializeCreateApiKeyResponse(dbApiKey: {
    uuid: string;
    name: string;
    key: string;
    user_id: string | null;
    created_at: Date;
  }) {
    return {
      uuid: dbApiKey.uuid,
      name: dbApiKey.name,
      key: dbApiKey.key,
      created_at: dbApiKey.created_at,
    };
  }
}
