import "server-only";
import { isCategory, type Expense } from "./expense-types";

// Storage is a Google Sheet behind an Apps Script web app (see README).
function config() {
  const url = process.env.SHEETS_URL;
  const secret = process.env.SHEETS_SECRET;
  if (!url || !secret) {
    throw new Error("Set SHEETS_URL and SHEETS_SECRET in .env.local, then restart the dev server.");
  }
  return { url, secret };
}

async function call<T>(init: { method: "GET" } | { method: "POST"; body: Record<string, unknown> }): Promise<T> {
  const { url, secret } = config();

  let response: Response;
  try {
    response =
      init.method === "GET"
        ? await fetch(`${url}?secret=${encodeURIComponent(secret)}`, { cache: "no-store" })
        : await fetch(url, {
            method: "POST",
            // text/plain keeps Apps Script from rejecting the request on content type
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ ...init.body, secret }),
            cache: "no-store",
          });
  } catch {
    throw new Error("Could not reach Google Sheets. Check your internet connection.");
  }

  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!data) throw new Error("Google Sheets sent back something unexpected. Is the script deployed as a web app?");
  if (data.error) {
    throw new Error(data.error === "unauthorized" ? "Wrong SHEETS_SECRET in .env.local." : data.error);
  }
  return data;
}

export async function listExpenses(): Promise<Expense[]> {
  const { expenses } = await call<{ expenses: Expense[] }>({ method: "GET" });
  return expenses.map((expense) => ({
    ...expense,
    amount: Math.round(Number(expense.amount) * 100) / 100,
    category: isCategory(expense.category) ? expense.category : "other",
  }));
}

export async function addExpense(input: Omit<Expense, "id">): Promise<Expense> {
  const { expense } = await call<{ expense: Expense }>({ method: "POST", body: { action: "add", ...input } });
  return expense;
}

export async function deleteExpense(id: string): Promise<boolean> {
  try {
    await call({ method: "POST", body: { action: "delete", id } });
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes("no longer exists")) return false;
    throw error;
  }
}
