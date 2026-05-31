import { beforeEach, describe, expect, it, vi } from "vitest";

const findByUuid = vi.fn();
const findSession = vi.fn();
const upsertSession = vi.fn();
const canManageResource = vi.fn();

vi.mock("../db/repositories", () => ({
  mcpServersRepository: { findByUuid: (...a: unknown[]) => findByUuid(...a) },
  oauthSessionsRepository: {
    findByMcpServerUuid: (...a: unknown[]) => findSession(...a),
    upsert: (...a: unknown[]) => upsertSession(...a),
  },
}));

vi.mock("../db/serializers", () => ({
  OAuthSessionsSerializer: { serializeOAuthSession: (s: unknown) => s },
}));

vi.mock("../lib/authz", () => ({
  canManageResource: (...a: unknown[]) => canManageResource(...a),
}));

import { oauthImplementations } from "./oauth.impl";

const PUBLIC_SERVER = { uuid: "s1", user_id: null };

describe("oauth session impl ownership", () => {
  beforeEach(() => {
    findByUuid.mockReset();
    findSession.mockReset();
    upsertSession.mockReset();
    canManageResource.mockReset();
    findByUuid.mockResolvedValue(PUBLIC_SERVER);
  });

  it("denies a non-admin reading a public server's oauth session", async () => {
    canManageResource.mockResolvedValue(false);
    const res = await oauthImplementations.get(
      { mcp_server_uuid: "s1" },
      "attacker",
    );
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/access denied/i);
    expect(findSession).not.toHaveBeenCalled();
  });

  it("denies a non-admin overwriting a public server's oauth session", async () => {
    canManageResource.mockResolvedValue(false);
    const res = await oauthImplementations.upsert(
      { mcp_server_uuid: "s1", tokens: { access_token: "x" } },
      "attacker",
    );
    expect(res.success).toBe(false);
    expect(upsertSession).not.toHaveBeenCalled();
  });

  it("allows an owner/admin to read the session", async () => {
    canManageResource.mockResolvedValue(true);
    findSession.mockResolvedValue({ mcp_server_uuid: "s1", tokens: {} });
    const res = await oauthImplementations.get(
      { mcp_server_uuid: "s1" },
      "owner",
    );
    expect(res.success).toBe(true);
    expect(findSession).toHaveBeenCalledWith("s1");
  });
});
