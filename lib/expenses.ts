import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { isCategory, type Expense } from "./expense-types";

export const EXPENSES_PATH = path.join(process.cwd(), "data", "expenses.xlsx");

const EXPENSE_SHEET = "Expenses";
const DAILY_SHEET = "Daily";

// Every read-modify-write goes through this queue so two quick taps can't
// clobber each other's rows.
let queue: Promise<unknown> = Promise.resolve();

function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function plain(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const cell = value as unknown as Record<string, unknown>;
    if ("result" in cell) return cell.result;
    if (Array.isArray(cell.richText)) {
      return cell.richText.map((run: { text?: string }) => run.text ?? "").join("");
    }
    if ("text" in cell) return cell.text;
  }
  return value;
}

// Rows typed by hand in Excel come back as Date objects (stored as UTC).
function asDate(value: unknown): string | null {
  if (value instanceof Date) {
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function asTime(value: unknown): string {
  if (value instanceof Date) return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
  const text = String(value ?? "").trim();
  return /^\d{1,2}:\d{2}$/.test(text) ? text.padStart(5, "0") : "00:00";
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function readExpenses(): Promise<{ expenses: Expense[]; missingIds: boolean }> {
  if (!(await exists(EXPENSES_PATH))) return { expenses: [], missingIds: false };

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXPENSES_PATH);
  const sheet = workbook.getWorksheet(EXPENSE_SHEET) ?? workbook.worksheets[0];
  if (!sheet) return { expenses: [], missingIds: false };

  const expenses: Expense[] = [];
  let missingIds = false;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const date = asDate(plain(row.getCell(1).value));
    const amount = Number(plain(row.getCell(3).value));
    if (!date || !Number.isFinite(amount) || amount <= 0) return;

    const category = String(plain(row.getCell(4).value) ?? "").trim().toLowerCase();
    let id = String(plain(row.getCell(6).value) ?? "").trim();
    if (!id) {
      id = randomUUID();
      missingIds = true;
    }

    expenses.push({
      id,
      date,
      time: asTime(plain(row.getCell(2).value)),
      amount: Math.round(amount * 100) / 100,
      category: isCategory(category) ? category : "other",
      note: String(plain(row.getCell(5).value) ?? "").trim(),
    });
  });

  return { expenses, missingIds };
}

async function writeExpenses(expenses: Expense[]): Promise<void> {
  const sorted = [...expenses].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "masrouf";

  const sheet = workbook.addWorksheet(EXPENSE_SHEET, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Time", key: "time", width: 8 },
    { header: "Amount", key: "amount", width: 12, style: { numFmt: "#,##0.00" } },
    { header: "Category", key: "category", width: 12 },
    { header: "Note", key: "note", width: 36 },
    { header: "ID", key: "id", width: 38, hidden: true },
  ];
  sheet.addRows(sorted);
  sheet.getRow(1).font = { bold: true };

  const totals = new Map<string, { total: number; count: number }>();
  for (const expense of sorted) {
    const day = totals.get(expense.date) ?? { total: 0, count: 0 };
    day.total += expense.amount;
    day.count += 1;
    totals.set(expense.date, day);
  }

  // Formulas keep the Daily sheet correct even if rows are edited by hand in Excel.
  const daily = workbook.addWorksheet(DAILY_SHEET, { views: [{ state: "frozen", ySplit: 1 }] });
  daily.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Spent", key: "spent", width: 12, style: { numFmt: "#,##0.00" } },
    { header: "Entries", key: "entries", width: 9 },
  ];
  [...totals.entries()].forEach(([date, { total, count }], index) => {
    const row = index + 2;
    daily.addRow({
      date,
      spent: { formula: `SUMIF(${EXPENSE_SHEET}!A:A,A${row},${EXPENSE_SHEET}!C:C)`, result: Math.round(total * 100) / 100 },
      entries: { formula: `COUNTIF(${EXPENSE_SHEET}!A:A,A${row})`, result: count },
    });
  });
  daily.getRow(1).font = { bold: true };

  await mkdir(path.dirname(EXPENSES_PATH), { recursive: true });
  const temp = `${EXPENSES_PATH}.tmp`;
  await workbook.xlsx.writeFile(temp);
  try {
    await rename(temp, EXPENSES_PATH);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
      throw new Error("expenses.xlsx is open in another program. Close it and try again.");
    }
    throw error;
  }
}

export function listExpenses(): Promise<Expense[]> {
  return exclusive(async () => {
    const { expenses, missingIds } = await readExpenses();
    // Rows added by hand get an id saved back so they can be deleted from the app.
    if (missingIds) await writeExpenses(expenses).catch(() => undefined);
    return expenses;
  });
}

export function addExpense(input: Omit<Expense, "id">): Promise<Expense> {
  return exclusive(async () => {
    const { expenses } = await readExpenses();
    const expense: Expense = { ...input, id: randomUUID() };
    await writeExpenses([...expenses, expense]);
    return expense;
  });
}

export function deleteExpense(id: string): Promise<boolean> {
  return exclusive(async () => {
    const { expenses } = await readExpenses();
    const remaining = expenses.filter((expense) => expense.id !== id);
    if (remaining.length === expenses.length) return false;
    await writeExpenses(remaining);
    return true;
  });
}

export function readWorkbook(): Promise<Buffer> {
  return exclusive(async () => {
    if (!(await exists(EXPENSES_PATH))) await writeExpenses([]);
    return readFile(EXPENSES_PATH);
  });
}
