import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { sendSafeError } from "./http-errors";

function mockRes(headersSent = false) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return {
    res: { headersSent, status } as unknown as Response,
    status,
    json,
  };
}

describe("sendSafeError", () => {
  it("sends only a generic message, never the raw error", () => {
    const { res, status, json } = mockRes();
    sendSafeError(res, 500, "Internal server error");
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: "Internal server error" });
    // ensure the payload has no stack/extra fields
    expect(Object.keys(json.mock.calls[0][0])).toEqual(["error"]);
  });

  it("is a no-op when headers were already sent", () => {
    const { res, status } = mockRes(true);
    sendSafeError(res, 500, "Internal server error");
    expect(status).not.toHaveBeenCalled();
  });
});
