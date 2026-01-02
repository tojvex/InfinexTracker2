import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runIndexerOnce } from "@/indexer/indexer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function isAuthorized(request: Request) {
  const secret = process.env.INDEXER_SECRET;
  if (!secret) return true;

  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret");
  const headerSecret = request.headers.get("x-indexer-secret");

  return querySecret === secret || headerSecret === secret;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await runIndexerOnce({ prisma, runAll: true });
    return NextResponse.json({ ok: true, results });
  } catch (error) {
    console.error("Indexer cron failed", error);
    return NextResponse.json(
      { ok: false, error: "Indexer run failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  return GET(request);
}
