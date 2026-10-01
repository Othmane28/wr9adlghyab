import { readWorkbook } from "@/lib/expenses";

export async function GET() {
  try {
    const file = await readWorkbook();
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="expenses.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read expenses.xlsx";
    return Response.json({ error: message }, { status: 500 });
  }
}
