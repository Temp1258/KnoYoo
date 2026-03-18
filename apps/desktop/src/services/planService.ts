import { tauriInvoke } from "../hooks/useTauriInvoke";
import type { PlanTask, PlanGroup, WeekReport } from "../types";

type PlanTaskOut = {
  id: number;
  skill_id: number | null;
  title: string;
  minutes: number;
  due: string | null;
  status: string;
};

const CMD = {
  GENERATE: "generate_plan",
  LIST: "list_plan_tasks",
  UPDATE_STATUS: "update_plan_status",
  DELETE: "delete_plan_task",
  UPDATE: "update_plan_task",
  ADD: "add_plan_task",
  CLEANUP: "cleanup_plan_duplicates",
  WEEK_SUMMARY: "report_week_summary",
  GET_GOAL: "get_plan_goal",
  SET_GOAL: "set_plan_goal",
  GENERATE_RANGE: "generate_plan_by_range",
  AI_GENERATE_RANGE: "ai_generate_plan_by_range",
  CREATE_GROUP: "create_plan_group",
  LIST_GROUPS: "list_plan_groups",
  UPDATE_GROUP: "update_plan_group",
  DELETE_GROUP: "delete_plan_group",
  LIST_BY_MONTH: "list_plan_tasks_by_month",
} as const;

export async function generatePlan(horizon: string): Promise<PlanTaskOut[]> {
  return tauriInvoke<PlanTaskOut[]>(CMD.GENERATE, { horizon });
}

export async function listPlanTasks(horizon?: string, status?: string): Promise<PlanTask[]> {
  return tauriInvoke<PlanTask[]>(CMD.LIST, { horizon, status });
}

export async function updatePlanStatus(id: number, status: string): Promise<void> {
  return tauriInvoke<void>(CMD.UPDATE_STATUS, { id, status });
}

export async function deletePlanTask(id: number): Promise<void> {
  return tauriInvoke<void>(CMD.DELETE, { id });
}

export async function updatePlanTask(
  id: number,
  title: string,
  minutes: number,
  due?: string | null,
): Promise<void> {
  return tauriInvoke<void>(CMD.UPDATE, { id, title, minutes, due });
}

export async function addPlanTask(args: {
  horizon: string;
  skill_id?: number | null;
  title: string;
  minutes?: number | null;
  due?: string | null;
  groupId?: number | null;
  parentId?: number | null;
  description?: string | null;
}): Promise<number> {
  return tauriInvoke<number>(CMD.ADD, args);
}

export async function cleanupPlanDuplicates(horizon?: string): Promise<number> {
  return tauriInvoke<number>(CMD.CLEANUP, { horizon });
}

export async function reportWeekSummary(): Promise<WeekReport> {
  return tauriInvoke<WeekReport>(CMD.WEEK_SUMMARY);
}

export async function getPlanGoal(): Promise<string> {
  return tauriInvoke<string>(CMD.GET_GOAL);
}

export async function setPlanGoal(goal: string): Promise<void> {
  return tauriInvoke<void>(CMD.SET_GOAL, { goal });
}

export async function generatePlanByRange(
  start: string,
  end: string,
  goal?: string | null,
): Promise<PlanTaskOut[]> {
  return tauriInvoke<PlanTaskOut[]>(CMD.GENERATE_RANGE, { start, end, goal });
}

export async function aiGeneratePlanByRange(
  start: string,
  end: string,
  goal?: string | null,
): Promise<PlanTaskOut[]> {
  return tauriInvoke<PlanTaskOut[]>(CMD.AI_GENERATE_RANGE, { start, end, goal });
}

export async function createPlanGroup(name: string, color?: string | null): Promise<PlanGroup> {
  return tauriInvoke<PlanGroup>(CMD.CREATE_GROUP, { name, color });
}

export async function listPlanGroups(): Promise<PlanGroup[]> {
  return tauriInvoke<PlanGroup[]>(CMD.LIST_GROUPS);
}

export async function updatePlanGroup(
  id: number,
  name: string,
  color?: string | null,
): Promise<void> {
  return tauriInvoke<void>(CMD.UPDATE_GROUP, { id, name, color });
}

export async function deletePlanGroup(id: number): Promise<void> {
  return tauriInvoke<void>(CMD.DELETE_GROUP, { id });
}

export async function listPlanTasksByMonth(year: number, month: number): Promise<PlanTask[]> {
  return tauriInvoke<PlanTask[]>(CMD.LIST_BY_MONTH, { year, month });
}
