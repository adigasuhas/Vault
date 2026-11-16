import { describe, it, expect } from "vitest";
import { budgetGroups, groupSpent, orderTree, planTotal } from "@/lib/budget-tree";

// Groceries › (Fruit & veg, Dairy, Snacks); Rent stands alone; Savings › Investments.
const cats = [
  { id: "groc", parentId: null },
  { id: "veg", parentId: "groc" },
  { id: "dairy", parentId: "groc" },
  { id: "snacks", parentId: "groc" },
  { id: "rent", parentId: null },
  { id: "save", parentId: null },
  { id: "inv", parentId: "save" },
];

describe("budgetGroups", () => {
  it("budgets a parent alone, without any subcategory split", () => {
    const [g] = budgetGroups([{ categoryId: "groc", amount: 200 }], cats);
    expect(g).toMatchObject({ rootId: "groc", own: 200, breakdown: 0, total: 200, unassigned: 200, over: 0 });
    expect(g.members).toEqual(["groc", "veg", "dairy", "snacks"]);
  });

  it("treats subcategory lines as a breakdown of the parent, not extra money", () => {
    const groups = budgetGroups(
      [
        { categoryId: "groc", amount: 200 },
        { categoryId: "veg", amount: 80 },
        { categoryId: "dairy", amount: 60 },
      ],
      cats
    );
    expect(groups[0]).toMatchObject({ own: 200, breakdown: 140, total: 200, unassigned: 60, over: 0 });
    expect(planTotal(groups)).toBe(200);
  });

  it("uses the breakdown when there's no parent line", () => {
    const [g] = budgetGroups(
      [
        { categoryId: "veg", amount: 80 },
        { categoryId: "dairy", amount: 60 },
        { categoryId: "snacks", amount: 40 },
      ],
      cats
    );
    expect(g).toMatchObject({ rootId: "groc", own: null, breakdown: 180, total: 180, unassigned: 0 });
  });

  it("counts a breakdown that outgrew its parent once, and says by how much", () => {
    const [g] = budgetGroups(
      [
        { categoryId: "groc", amount: 100 },
        { categoryId: "veg", amount: 80 },
        { categoryId: "dairy", amount: 60 },
      ],
      cats
    );
    expect(g).toMatchObject({ total: 140, over: 40, unassigned: 0 });
  });

  it("adds up the stipend example to the whole income, each group once", () => {
    const groups = budgetGroups(
      [
        { categoryId: "rent", amount: 615 },
        { categoryId: "groc", amount: 200 },
        { categoryId: "veg", amount: 80 },
        { categoryId: "save", amount: 402 },
        { categoryId: "inv", amount: 150 },
      ],
      cats
    );
    expect(planTotal(groups)).toBe(1217);
    expect(groups.find((g) => g.rootId === "save")).toMatchObject({ own: 402, breakdown: 150, unassigned: 252 });
  });
});

describe("groupSpent", () => {
  it("counts spending on the parent and every subcategory, budgeted or not", () => {
    const [g] = budgetGroups([{ categoryId: "groc", amount: 200 }, { categoryId: "veg", amount: 80 }], cats);
    const spend = new Map([["groc", 10], ["veg", 30], ["snacks", 12.5], ["rent", 615]]);
    expect(groupSpent(g, spend)).toBe(52.5);
  });
});

describe("orderTree", () => {
  it("lists each parent followed by its subcategories, in their own order", () => {
    const list = orderTree([
      { id: "b", parentId: null, name: "Home", sortOrder: 1 },
      { id: "a", parentId: null, name: "Food", sortOrder: 0 },
      { id: "a2", parentId: "a", name: "Eating out", sortOrder: 1 },
      { id: "a1", parentId: "a", name: "Groceries", sortOrder: 0 },
      { id: "x", parentId: "gone", name: "Orphan", sortOrder: 5 },
    ]);
    expect(list.map((c) => `${c.depth}:${c.name}`)).toEqual(["0:Food", "1:Groceries", "1:Eating out", "0:Home", "0:Orphan"]);
  });
});
