export const CATEGORIES = ["food", "transport", "shopping", "bills", "fun", "other"] as const;

export type Category = (typeof CATEGORIES)[number];

export type Expense = {
  id: string;
  date: string; // YYYY-MM-DD, local to whoever logged it
  time: string; // HH:MM
  amount: number;
  category: Category;
  note: string;
};

export const CURRENCY = "DH";

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}
