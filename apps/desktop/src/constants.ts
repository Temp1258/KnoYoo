// === Canvas / MindMap ===
export const BASE_NODE_W = 160;
export const MAX_NODE_W = 400;
export const NODE_H = 36;
export const ROW_GAP = 66;
export const PAD_LEFT = 40;
export const COL_GAP_DYNAMIC = 60;

// === Task Status ===
export const TASK_STATUS = {
  TODO: "TODO",
  DONE: "DONE",
} as const;

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

// === Plan Horizon ===
export const PLAN_HORIZON = {
  WEEK: "WEEK",
  QTR: "QTR",
} as const;

export type PlanHorizon = (typeof PLAN_HORIZON)[keyof typeof PLAN_HORIZON];

// === Pagination ===
export const DEFAULT_PAGE_SIZE = 10;
