import { tauriInvoke } from "../hooks/useTauriInvoke";
import type { IndustryNode, SkillNote, SavedTree } from "../types";

const CMD = {
  SEED: "seed_industry_v1",
  LIST_TREE: "list_industry_tree_v1",
  LIST_SKILL_NOTES: "list_skill_notes_v1",
  SAVE_ROOT: "save_custom_root_v1",
  LIST_ROOTS: "list_root_nodes_v1",
  DELETE_ROOT: "delete_root_and_subtree_v1",
  CLEAR_ROOTS: "clear_all_roots_v1",
  AI_EXPAND: "ai_expand_node_v2",
  SAVE_TREE: "save_industry_tree_v1",
  LIST_SAVED: "list_saved_industry_trees_v1",
  GET_SAVED: "get_saved_industry_tree_v1",
  DELETE_SAVED: "delete_saved_industry_tree_v1",
} as const;

export async function seedIndustry(): Promise<number> {
  return tauriInvoke<number>(CMD.SEED);
}

export async function listIndustryTree(): Promise<IndustryNode[]> {
  return tauriInvoke<IndustryNode[]>(CMD.LIST_TREE);
}

export async function listSkillNotes(skillId: number, limit?: number): Promise<SkillNote[]> {
  return tauriInvoke<SkillNote[]>(CMD.LIST_SKILL_NOTES, {
    skillId,
    limit: limit ?? 50,
  });
}

export async function saveCustomRoot(name: string): Promise<number> {
  return tauriInvoke<number>(CMD.SAVE_ROOT, { name });
}

export async function listRootNodes(): Promise<IndustryNode[]> {
  return tauriInvoke<IndustryNode[]>(CMD.LIST_ROOTS);
}

export async function deleteRootAndSubtree(rootId: number): Promise<void> {
  return tauriInvoke<void>(CMD.DELETE_ROOT, { rootId });
}

export async function clearAllRoots(): Promise<number> {
  return tauriInvoke<number>(CMD.CLEAR_ROOTS);
}

export async function aiExpandNode(args: {
  name: string;
  parentId?: number | null;
  limit?: number | null;
  pathNames?: string[] | null;
}): Promise<IndustryNode[]> {
  return tauriInvoke<IndustryNode[]>(CMD.AI_EXPAND, args);
}

export async function saveIndustryTree(name: string): Promise<number> {
  return tauriInvoke<number>(CMD.SAVE_TREE, { name });
}

export async function listSavedIndustryTrees(): Promise<SavedTree[]> {
  return tauriInvoke<SavedTree[]>(CMD.LIST_SAVED);
}

export async function getSavedIndustryTree(id: number): Promise<IndustryNode[]> {
  return tauriInvoke<IndustryNode[]>(CMD.GET_SAVED, { id });
}

export async function deleteSavedIndustryTree(id: number): Promise<void> {
  return tauriInvoke<void>(CMD.DELETE_SAVED, { id });
}
