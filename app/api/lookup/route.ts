import "server-only";
import { lookupById } from "@/lib/db";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");

  if (!id || id.trim().length === 0) {
    return Response.json({ found: false, error: "Missing 'id' parameter" }, { status: 400 });
  }

  try {
    const record = await lookupById(id);
    if (record) {
      return Response.json({ found: true, id: record.id, name: record.name }, { status: 200 });
    }
    return Response.json({ found: false, id: id.trim() }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read database";
    return Response.json({ found: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const id = body && typeof body === "object" && "id" in body ? (body as { id: unknown }).id : null;

    if (!id || (typeof id !== "string" && typeof id !== "number")) {
      return Response.json({ found: false, error: "Missing 'id' in body" }, { status: 400 });
    }

    const record = await lookupById(String(id));
    if (record) {
      return Response.json({ found: true, id: record.id, name: record.name }, { status: 200 });
    }
    return Response.json({ found: false, id: String(id).trim() }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read database";
    return Response.json({ found: false, error: message }, { status: 500 });
  }
}
