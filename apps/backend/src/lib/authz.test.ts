import { beforeEach, describe, expect, it, vi } from "vitest";

const isAdmin = vi.fn();

vi.mock("../db/repositories/users.repo", () => ({
  usersRepository: {
    isAdmin: (...args: unknown[]) => isAdmin(...args),
  },
}));

import { canManageResource, resolveOwnerUserId } from "./authz";

describe("resolveOwnerUserId", () => {
  beforeEach(() => {
    isAdmin.mockReset();
  });

  it("returns the fallback without an admin check when no owner is requested", async () => {
    await expect(resolveOwnerUserId(undefined, "me")).resolves.toBe("me");
    await expect(
      resolveOwnerUserId(undefined, "me", "existing-owner"),
    ).resolves.toBe("existing-owner");
    expect(isAdmin).not.toHaveBeenCalled();
  });

  it("ignores a client-supplied owner for non-admins (create → self)", async () => {
    isAdmin.mockResolvedValue(false);
    await expect(resolveOwnerUserId("victim", "me")).resolves.toBe("me");
  });

  it("prevents a non-admin from publishing a resource (user_id=null → self)", async () => {
    isAdmin.mockResolvedValue(false);
    await expect(resolveOwnerUserId(null, "me")).resolves.toBe("me");
  });

  it("prevents a non-admin from changing ownership on update (keeps existing)", async () => {
    isAdmin.mockResolvedValue(false);
    await expect(
      resolveOwnerUserId("victim", "me", "original-owner"),
    ).resolves.toBe("original-owner");
  });

  it("lets an admin assign a resource to another user", async () => {
    isAdmin.mockResolvedValue(true);
    await expect(resolveOwnerUserId("victim", "admin")).resolves.toBe("victim");
  });

  it("lets an admin create a public (user_id=null) resource", async () => {
    isAdmin.mockResolvedValue(true);
    await expect(resolveOwnerUserId(null, "admin")).resolves.toBeNull();
  });
});

describe("canManageResource", () => {
  beforeEach(() => {
    isAdmin.mockReset();
  });

  it("allows the owner without an admin check", async () => {
    await expect(canManageResource("me", "me")).resolves.toBe(true);
    expect(isAdmin).not.toHaveBeenCalled();
  });

  it("denies a non-owner non-admin", async () => {
    isAdmin.mockResolvedValue(false);
    await expect(canManageResource("someone-else", "me")).resolves.toBe(false);
  });

  it("denies a non-admin managing a public (null-owner) resource", async () => {
    isAdmin.mockResolvedValue(false);
    await expect(canManageResource(null, "me")).resolves.toBe(false);
  });

  it("allows an admin to manage any resource, including public", async () => {
    isAdmin.mockResolvedValue(true);
    await expect(canManageResource(null, "admin")).resolves.toBe(true);
    await expect(canManageResource("someone-else", "admin")).resolves.toBe(
      true,
    );
  });
});
