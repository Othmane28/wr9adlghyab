import { NextRequest } from "next/server";
import { isCategory } from "@/lib/expense-types";
import { addExpense, deleteExpense, listExpenses } from "@/lib/expenses";

function failure(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return Response.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    return Response.json({ expenses: await listExpenses() });
  } catch (error) {
    return failure(error, "Could not read expenses.xlsx");
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Invalid request" }, { status: 400 });

  const amount = Math.round(Number(body.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    return Response.json({ error: "Enter an amount above 0" }, { status: 400 });
  }

  const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
  const time = typeof body.time === "string" && /^\d{2}:\d{2}$/.test(body.time) ? body.time : null;
  if (!date || !time) return Response.json({ error: "Missing date or time" }, { status: 400 });

  try {
    const expense = await addExpense({
      date,
      time,
      amount,
      category: isCategory(body.category) ? body.category : "other",
      note: typeof body.note === "string" ? body.note.trim().slice(0, 80) : "",
    });
    return Response.json({ expense }, { status: 201 });
  } catch (error) {
    return failure(error, "Could not save to expenses.xlsx");
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });

  try {
    const removed = await deleteExpense(id);
    return removed
      ? Response.json({ ok: true })
      : Response.json({ error: "That entry no longer exists" }, { status: 404 });
  } catch (error) {
    return failure(error, "Could not update expenses.xlsx");
  }
}
