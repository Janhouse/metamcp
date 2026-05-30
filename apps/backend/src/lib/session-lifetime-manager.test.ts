import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./config.service", () => ({
  configService: {
    getSessionLifetime: vi.fn().mockResolvedValue(null),
  },
}));

import { SessionLifetimeManagerImpl } from "./session-lifetime-manager";

describe("SessionLifetimeManagerImpl.startCleanupTimer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears the previous interval when started again (no timer leak)", () => {
    const clearSpy = vi.spyOn(global, "clearInterval");
    const mgr = new SessionLifetimeManagerImpl<object>("test");
    const cb = vi.fn().mockResolvedValue(undefined);

    mgr.startCleanupTimer(cb, 1000);
    expect(clearSpy).not.toHaveBeenCalled(); // nothing to clear yet

    mgr.startCleanupTimer(cb, 1000); // must clear the first timer
    expect(clearSpy).toHaveBeenCalledTimes(1);

    mgr.stopCleanupTimer();
    expect(clearSpy).toHaveBeenCalledTimes(2);
  });
});
