import crypto from "node:crypto";
import type { AddressInfo } from "node:net";

import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// In-memory auth-code store backing the mocked repository.
const codeStore = new Map<string, unknown>();

vi.mock("../../db/repositories", () => ({
  oauthRepository: {
    getAuthCode: vi.fn((code: string) => codeStore.get(code) ?? null),
    deleteAuthCode: vi.fn((code: string) => {
      codeStore.delete(code);
    }),
    getClient: vi.fn(() => ({
      client_id: "client-1",
      token_endpoint_auth_method: "none",
    })),
    setAccessToken: vi.fn(),
    getAccessTokenByRefreshToken: vi.fn(),
    deleteAccessTokenByRefreshToken: vi.fn(),
    getAccessToken: vi.fn(),
    deleteAccessToken: vi.fn(),
  },
}));

import tokenRouter from "./token";

let server: ReturnType<express.Express["listen"]>;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(tokenRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function seedCode(method: string, verifier: string) {
  const challenge =
    method === "S256"
      ? crypto.createHash("sha256").update(verifier).digest("base64url")
      : verifier;
  codeStore.set("code-1", {
    client_id: "client-1",
    user_id: "user-1",
    scope: "admin",
    redirect_uri: "https://app.example/cb",
    code_challenge: challenge,
    code_challenge_method: method,
    expires_at: new Date(Date.now() + 600_000),
  });
}

function exchange(verifier: string) {
  return fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: "code-1",
      client_id: "client-1",
      redirect_uri: "https://app.example/cb",
      code_verifier: verifier,
    }),
  });
}

describe("token endpoint PKCE enforcement", () => {
  it("rejects the insecure 'plain' challenge method", async () => {
    seedCode("plain", "verifier-123");
    const res = await exchange("verifier-123");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error_description?: string };
    expect(body.error_description).toMatch(/S256/);
  });

  it("accepts a valid S256 verifier", async () => {
    seedCode("S256", "verifier-123");
    const res = await exchange("verifier-123");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token?: string };
    expect(body.access_token).toMatch(/^mcp_token_/);
  });

  it("rejects a wrong S256 verifier", async () => {
    seedCode("S256", "verifier-123");
    const res = await exchange("wrong-verifier");
    expect(res.status).toBe(400);
  });
});
