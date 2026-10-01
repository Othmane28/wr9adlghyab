import "server-only";
import { stat } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";

export const DATABASE_PATH = path.join(process.cwd(), "lib", "database.xlsx");

const ID_ALIASES = ["id", "code", "barcode", "matricule"];
const NAME_ALIASES = ["name", "full name", "fullname", "nom"];

export type DatabaseRecord = { id: string; name: string };

type Database = {
  signature: string;
  sheetName: string;
  count: number;
  byId: Map<string, DatabaseRecord>;
};

let cache: Database | null = null;

function normalizeKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);

  const cell = value as Record<string, unknown>;
  if (typeof cell.text === "string") return cell.text;
  if (cell.richText && Array.isArray(cell.richText)) {
    return cell.richText
      .map((run) => (typeof run === "object" && run ? String((run as { text?: unknown }).text ?? "") : ""))
      .join("");
  }
  if ("result" in cell) return String(cell.result);
  if ("hyperlink" in cell) return String(cell.hyperlink);
  return "";
}

function findHeaderIndex(headers: string[], aliases: string[]): number {
  return headers.findIndex((header) => aliases.includes(header));
}

async function parseDatabase(): Promise<Database> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(DATABASE_PATH);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error(`No sheet found in ${DATABASE_PATH}`);

  const byId = new Map<string, DatabaseRecord>();
  let header: { id: number; name: number } | null = null;
  let headerRow = 0;

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const values = row.values as unknown[];

    if (!header) {
      const headers = values.slice(1).map((value) => normalizeKey(cellText(value)));
      const idIndex = findHeaderIndex(headers, ID_ALIASES);
      const nameIndex = findHeaderIndex(headers, NAME_ALIASES);
      if (idIndex !== -1 && nameIndex !== -1) {
        header = { id: idIndex + 1, name: nameIndex + 1 };
        headerRow = rowNumber;
      }
      return;
    }

    if (rowNumber <= headerRow) return;

    const rawId = cellText(values[header.id]).trim();
    const name = cellText(values[header.name]).trim();
    if (!rawId || !name) return;

    const key = normalizeKey(rawId);
    if (!byId.has(key)) byId.set(key, { id: rawId, name });
  });

  if (!header) {
    throw new Error(`${DATABASE_PATH} must have an "id" column and a "name" column`);
  }

  return { signature: "", sheetName: sheet.name, count: byId.size, byId };
}

async function getDatabase(): Promise<Database> {
  const fileStat = await stat(DATABASE_PATH);
  const signature = `${fileStat.mtimeMs}:${fileStat.size}`;

  if (cache && cache.signature === signature) return cache;

  const parsed = await parseDatabase();
  cache = { ...parsed, signature };
  return cache;
}

export async function lookupById(id: string): Promise<DatabaseRecord | null> {
  const { byId } = await getDatabase();
  return byId.get(normalizeKey(id)) ?? null;
}

export async function getDatabaseInfo(): Promise<{ count: number; sheetName: string }> {
  const { count, sheetName } = await getDatabase();
  return { count, sheetName };
}
