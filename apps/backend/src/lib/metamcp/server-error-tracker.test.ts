import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the dependencies before importing the module
vi.mock("@repo/zod-types", () => ({
  McpServerErrorStatusEnum: {
    enum: { ERROR: "ERROR", NONE: "NONE" },
  },
}));

vi.mock("@/utils/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../db/repositories/index", () => ({
  mcpServersRepository: {
    findByUuid: vi.fn(),
    updateServerErrorStatus: vi.fn(),
  },
}));

vi.mock("../../db/repositories", () => ({
  mcpServersRepository: {
    findByUuid: vi.fn(),
    updateServerErrorStatus: vi.fn(),
  },
}));

vi.mock("../config.service", () => ({
  configService: {
    getMcpMaxAttempts: vi.fn().mockRejectedValue(new Error("no db")),
  },
}));

import { mcpServersRepository } from "../../db/repositories";
import { ServerErrorTracker } from "./server-error-tracker";

describe("ServerErrorTracker", () => {
  let tracker: ServerErrorTracker;

  beforeEach(() => {
    // Reset the singleton so each test gets a fresh instance
    (ServerErrorTracker as any).instance = null;
    tracker = ServerErrorTracker.getInstance();
    vi.clearAllMocks();
  });

  describe("fallbackMaxAttempts", () => {
    it("should default to 3 attempts before ERROR state", async () => {
      // When config service is unavailable, falls back to fallbackMaxAttempts
      const maxAttempts = await tracker.getServerMaxAttempts("server-1");
      expect(maxAttempts).toBe(3);
    });
  });

  describe("server-specific max attempts", () => {
    it("should use server-specific max attempts when set", async () => {
      tracker.setServerMaxAttempts("server-1", 5);
      const maxAttempts = await tracker.getServerMaxAttempts("server-1");
      expect(maxAttempts).toBe(5);
    });

    it("should fall back when no server-specific config", async () => {
      const maxAttempts = await tracker.getServerMaxAttempts("server-unknown");
      expect(maxAttempts).toBe(3);
    });
  });

  describe("crash tracking", () => {
    it("should track crash attempts", () => {
      expect(tracker.getServerAttempts("server-1")).toBe(0);
    });

    it("should reset crash attempts", () => {
      // Simulate crashes by directly manipulating
      (tracker as any).crashAttempts.set("server-1", 2);
      expect(tracker.getServerAttempts("server-1")).toBe(2);

      tracker.resetServerAttempts("server-1");
      expect(tracker.getServerAttempts("server-1")).toBe(0);
    });
  });

  describe("recordServerCrash", () => {
    it("should not mark server as ERROR before reaching max attempts", async () => {
      // With fallbackMaxAttempts=3, first 2 crashes should not trigger ERROR
      await tracker.recordServerCrash("server-1", 1, null);
      expect(tracker.getServerAttempts("server-1")).toBe(1);
      expect(
        mcpServersRepository.updateServerErrorStatus,
      ).not.toHaveBeenCalled();

      await tracker.recordServerCrash("server-1", 1, null);
      expect(tracker.getServerAttempts("server-1")).toBe(2);
      expect(
        mcpServersRepository.updateServerErrorStatus,
      ).not.toHaveBeenCalled();
    });

    it("should mark server as ERROR when reaching max attempts", async () => {
      await tracker.recordServerCrash("server-1", 1, null);
      await tracker.recordServerCrash("server-1", 1, null);
      await tracker.recordServerCrash("server-1", 1, null);

      expect(tracker.getServerAttempts("server-1")).toBe(3);
      expect(mcpServersRepository.updateServerErrorStatus).toHaveBeenCalledWith(
        {
          serverUuid: "server-1",
          errorStatus: "ERROR",
        },
      );
    });

    it("should track different servers independently", async () => {
      await tracker.recordServerCrash("server-1", 1, null);
      await tracker.recordServerCrash("server-1", 1, null);
      await tracker.recordServerCrash("server-2", 1, null);

      expect(tracker.getServerAttempts("server-1")).toBe(2);
      expect(tracker.getServerAttempts("server-2")).toBe(1);
    });
  });

  describe("resetServerErrorState", () => {
    it("should reset crash attempts and update database", async () => {
      (tracker as any).crashAttempts.set("server-1", 3);

      await tracker.resetServerErrorState("server-1");

      expect(tracker.getServerAttempts("server-1")).toBe(0);
      expect(mcpServersRepository.updateServerErrorStatus).toHaveBeenCalledWith(
        {
          serverUuid: "server-1",
          errorStatus: "NONE",
        },
      );
    });
  });
});
