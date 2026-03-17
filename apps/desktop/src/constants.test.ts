import { describe, it, expect } from "vitest";
import { BASE_NODE_W, MAX_NODE_W, TASK_STATUS, PLAN_HORIZON, DEFAULT_PAGE_SIZE } from "./constants";

describe("constants", () => {
  it("has valid canvas dimensions", () => {
    expect(BASE_NODE_W).toBeGreaterThan(0);
    expect(MAX_NODE_W).toBeGreaterThan(BASE_NODE_W);
  });

  it("has correct task statuses", () => {
    expect(TASK_STATUS.TODO).toBe("TODO");
    expect(TASK_STATUS.DONE).toBe("DONE");
  });

  it("has correct plan horizons", () => {
    expect(PLAN_HORIZON.WEEK).toBe("WEEK");
    expect(PLAN_HORIZON.QTR).toBe("QTR");
  });

  it("has valid page size", () => {
    expect(DEFAULT_PAGE_SIZE).toBeGreaterThan(0);
  });
});
