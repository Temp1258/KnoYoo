import { describe, it, expect } from "vitest";
import {
  findNodeById,
  findPathToNode,
  flattenByDepth,
  findNodeByName,
  getNodeWidth,
} from "./treeUtils";
import type { IndustryNode } from "../types";

function makeNode(id: number, name: string, children: IndustryNode[] = []): IndustryNode {
  return { id, name, children, required_level: 0, importance: 0 };
}

const sampleTree: IndustryNode[] = [
  makeNode(1, "Root", [
    makeNode(2, "Child A", [makeNode(4, "Grandchild A1")]),
    makeNode(3, "Child B"),
  ]),
];

describe("findNodeById", () => {
  it("finds root node", () => {
    expect(findNodeById(sampleTree, 1)?.name).toBe("Root");
  });

  it("finds nested node", () => {
    expect(findNodeById(sampleTree, 4)?.name).toBe("Grandchild A1");
  });

  it("returns null for missing id", () => {
    expect(findNodeById(sampleTree, 999)).toBeNull();
  });
});

describe("findPathToNode", () => {
  it("returns path to nested node", () => {
    const path = findPathToNode(sampleTree, 4);
    expect(path?.map((n) => n.name)).toEqual(["Root", "Child A", "Grandchild A1"]);
  });

  it("returns null for missing node", () => {
    expect(findPathToNode(sampleTree, 999)).toBeNull();
  });
});

describe("flattenByDepth", () => {
  it("groups nodes by depth", () => {
    const layers = flattenByDepth(sampleTree);
    expect(layers).toHaveLength(3);
    expect(layers[0].map((n) => n.name)).toEqual(["Root"]);
    expect(layers[1].map((n) => n.name)).toEqual(["Child A", "Child B"]);
    expect(layers[2].map((n) => n.name)).toEqual(["Grandchild A1"]);
  });
});

describe("findNodeByName", () => {
  it("finds node case-insensitively", () => {
    expect(findNodeByName(sampleTree, "child a")?.id).toBe(2);
  });

  it("returns null for missing name", () => {
    expect(findNodeByName(sampleTree, "nonexistent")).toBeNull();
  });
});

describe("getNodeWidth", () => {
  it("returns base width for short names", () => {
    expect(getNodeWidth("Hi")).toBe(160);
  });

  it("caps at max width for long names", () => {
    expect(getNodeWidth("A".repeat(100))).toBe(400);
  });
});
