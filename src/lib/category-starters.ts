// VAULT's starter categories. No server imports: the category manager uses
// these in the browser too.

/** Starter categories for an ordinary month: housing and food first, then
 * the costs generic lists tend to miss (fees, learning, family). Users rename
 * or extend them freely. */
export const DEFAULT_CATEGORIES = [
  "Rent & housing",
  "Groceries",
  "Eating out",
  "Transport",
  "Utilities & internet",
  "Phone",
  "Books & learning",
  "Travel",
  "Education & fees",
  "Health",
  "Insurance",
  "Subscriptions",
  "Personal care",
  "Entertainment",
  "Family support",
  "Savings",
  "Miscellaneous",
];

/** How the starter categories are grouped: each group is a parent, its
 * members its subcategories; categories not listed stay top-level. Every
 * starter keeps its name and meaning; the groups only organise them. */
export const STARTER_GROUPS: { name: string; children: string[] }[] = [
  { name: "Home & bills", children: ["Rent & housing", "Utilities & internet", "Phone", "Insurance", "Subscriptions"] },
  { name: "Food", children: ["Groceries", "Eating out"] },
  { name: "Getting around", children: ["Transport", "Travel"] },
  { name: "Learning", children: ["Books & learning", "Education & fees"] },
  { name: "Health & personal", children: ["Health", "Personal care"] },
];
