import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture the ownership conditions handed to `and(...)` by the repository so we
// can assert that non-admins are always constrained to their own user_id while
// admins are not (i.e. public keys are not world-mutable).
let lastConditions: unknown[] = [];

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: unknown, val: unknown) => ({ kind: "eq", col, val }),
    and: (...conds: unknown[]) => {
      lastConditions = conds;
      return { kind: "and", conds };
    },
  };
});

const returning = vi.fn().mockResolvedValue([{ uuid: "k1", name: "key" }]);
const where = vi.fn().mockReturnValue({ returning });
const set = vi.fn().mockReturnValue({ where });

vi.mock("../index", () => ({
  db: {
    update: () => ({ set }),
    delete: () => ({ where }),
  },
}));

import { ApiKeysRepository } from "./api-keys.repo";

const repo = new ApiKeysRepository();

function userIdConditionCount() {
  // schema column for user_id resolves to an object; we only need to know how
  // many eq() conditions were combined: 1 = uuid only (admin), 2 = uuid+owner.
  return (lastConditions as { kind: string }[]).filter((c) => c.kind === "eq")
    .length;
}

describe("ApiKeysRepository ownership scoping (public keys are admin-only)", () => {
  beforeEach(() => {
    lastConditions = [];
    where.mockClear();
    returning.mockClear();
    set.mockClear();
  });

  it("delete: non-admin is constrained to uuid + own user_id", async () => {
    await repo.delete("k1", "me", false);
    expect(userIdConditionCount()).toBe(2);
  });

  it("delete: admin is constrained only by uuid (may delete public keys)", async () => {
    await repo.delete("k1", "admin", true);
    expect(userIdConditionCount()).toBe(1);
  });

  it("update: non-admin is constrained to uuid + own user_id", async () => {
    await repo.update("k1", "me", { name: "x" }, false);
    expect(userIdConditionCount()).toBe(2);
  });

  it("update: admin is constrained only by uuid", async () => {
    await repo.update("k1", "admin", { name: "x" }, true);
    expect(userIdConditionCount()).toBe(1);
  });

  it("delete defaults to non-admin scoping when isAdmin is omitted", async () => {
    await repo.delete("k1", "me");
    expect(userIdConditionCount()).toBe(2);
  });
});
