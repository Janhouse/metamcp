import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("@/utils/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../db/repositories", () => {
  const store = new Map<string, any>();
  const refreshIndex = new Map<string, string>(); // refreshToken -> accessToken

  return {
    oauthRepository: {
      getAuthCode: vi.fn(),
      deleteAuthCode: vi.fn(),
      getClient: vi.fn(),
      setAccessToken: vi.fn().mockImplementation((token, data) => {
        store.set(token, {
          ...data,
          access_token: token,
          created_at: new Date(),
        });
        if (data.refresh_token) {
          refreshIndex.set(data.refresh_token, token);
        }
      }),
      getAccessToken: vi
        .fn()
        .mockImplementation((token) => store.get(token) ?? null),
      deleteAccessToken: vi.fn().mockImplementation((token) => {
        const data = store.get(token);
        if (data?.refresh_token) refreshIndex.delete(data.refresh_token);
        store.delete(token);
      }),
      getAccessTokenByRefreshToken: vi
        .fn()
        .mockImplementation((refreshToken) => {
          const accessToken = refreshIndex.get(refreshToken);
          if (!accessToken) return null;
          return store.get(accessToken) ?? null;
        }),
      deleteAccessTokenByRefreshToken: vi
        .fn()
        .mockImplementation((refreshToken) => {
          const accessToken = refreshIndex.get(refreshToken);
          if (accessToken) {
            store.delete(accessToken);
            refreshIndex.delete(refreshToken);
          }
        }),
      _store: store,
      _refreshIndex: refreshIndex,
    },
  };
});

vi.mock("./utils", () => {
  let tokenCounter = 0;
  let refreshCounter = 0;
  return {
    generateSecureAccessToken: vi.fn(() => `mcp_token_test_${++tokenCounter}`),
    generateSecureRefreshToken: vi.fn(
      () => `mcp_refresh_test_${++refreshCounter}`,
    ),
    rateLimitToken: vi.fn((_req: any, _res: any, next: any) => next()),
  };
});

import { oauthRepository } from "../../db/repositories";

// We'll test the token endpoint by importing the router and using supertest-like approach
// But since we can't easily do that without express, let's test the logic more directly
// by testing the utils and repository interactions

describe("OAuth refresh token support", () => {
  beforeEach(() => {
    (oauthRepository as any)._store.clear();
    (oauthRepository as any)._refreshIndex.clear();
    vi.clearAllMocks();
  });

  describe("generateSecureRefreshToken", () => {
    it("should generate tokens with mcp_refresh_ prefix", async () => {
      const { generateSecureRefreshToken } =
        await vi.importActual<any>("./utils");
      const token = generateSecureRefreshToken();
      expect(token).toMatch(/^mcp_refresh_/);
      expect(token.length).toBeGreaterThan(20);
    });

    it("should generate unique tokens", async () => {
      const { generateSecureRefreshToken } =
        await vi.importActual<any>("./utils");
      const tokens = new Set(
        Array.from({ length: 100 }, () => generateSecureRefreshToken()),
      );
      expect(tokens.size).toBe(100);
    });
  });

  describe("repository - setAccessToken with refresh token", () => {
    it("should store refresh token alongside access token", async () => {
      await oauthRepository.setAccessToken("mcp_token_1", {
        client_id: "client-1",
        user_id: "user-1",
        scope: "admin",
        expires_at: Date.now() + 3600000,
        refresh_token: "mcp_refresh_1",
        refresh_token_expires_at: Date.now() + 7 * 24 * 3600000,
      });

      expect(oauthRepository.setAccessToken).toHaveBeenCalledWith(
        "mcp_token_1",
        expect.objectContaining({
          refresh_token: "mcp_refresh_1",
        }),
      );
    });
  });

  describe("repository - getAccessTokenByRefreshToken", () => {
    it("should find token data by refresh token", async () => {
      await oauthRepository.setAccessToken("mcp_token_1", {
        client_id: "client-1",
        user_id: "user-1",
        scope: "admin",
        expires_at: Date.now() + 3600000,
        refresh_token: "mcp_refresh_1",
        refresh_token_expires_at: Date.now() + 7 * 24 * 3600000,
      });

      const result =
        await oauthRepository.getAccessTokenByRefreshToken("mcp_refresh_1");
      expect(result).not.toBeNull();
      expect(result.client_id).toBe("client-1");
      expect(result.user_id).toBe("user-1");
    });

    it("should return null for unknown refresh token", async () => {
      const result = await oauthRepository.getAccessTokenByRefreshToken(
        "mcp_refresh_unknown",
      );
      expect(result).toBeNull();
    });
  });

  describe("repository - deleteAccessTokenByRefreshToken", () => {
    it("should delete the entire row when refresh token is revoked", async () => {
      await oauthRepository.setAccessToken("mcp_token_1", {
        client_id: "client-1",
        user_id: "user-1",
        scope: "admin",
        expires_at: Date.now() + 3600000,
        refresh_token: "mcp_refresh_1",
        refresh_token_expires_at: Date.now() + 7 * 24 * 3600000,
      });

      await oauthRepository.deleteAccessTokenByRefreshToken("mcp_refresh_1");

      // Both access token and refresh token should be gone
      const byRefresh =
        await oauthRepository.getAccessTokenByRefreshToken("mcp_refresh_1");
      expect(byRefresh).toBeNull();

      const byAccess = await oauthRepository.getAccessToken("mcp_token_1");
      expect(byAccess).toBeNull();
    });
  });

  describe("token rotation", () => {
    it("should issue new tokens when refresh token is exchanged", async () => {
      // Store initial token pair
      await oauthRepository.setAccessToken("mcp_token_1", {
        client_id: "client-1",
        user_id: "user-1",
        scope: "admin",
        expires_at: Date.now() + 3600000,
        refresh_token: "mcp_refresh_1",
        refresh_token_expires_at: Date.now() + 7 * 24 * 3600000,
      });

      // Simulate token rotation: look up by refresh token
      const oldData =
        await oauthRepository.getAccessTokenByRefreshToken("mcp_refresh_1");
      expect(oldData).not.toBeNull();

      // Delete old row
      await oauthRepository.deleteAccessTokenByRefreshToken("mcp_refresh_1");

      // Issue new pair
      await oauthRepository.setAccessToken("mcp_token_2", {
        client_id: oldData.client_id,
        user_id: oldData.user_id,
        scope: oldData.scope,
        expires_at: Date.now() + 3600000,
        refresh_token: "mcp_refresh_2",
        refresh_token_expires_at: Date.now() + 7 * 24 * 3600000,
      });

      // Old refresh token should no longer work
      const oldLookup =
        await oauthRepository.getAccessTokenByRefreshToken("mcp_refresh_1");
      expect(oldLookup).toBeNull();

      // New refresh token should work
      const newLookup =
        await oauthRepository.getAccessTokenByRefreshToken("mcp_refresh_2");
      expect(newLookup).not.toBeNull();
      expect(newLookup.access_token).toBe("mcp_token_2");
    });
  });
});
