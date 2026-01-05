import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(
  request: Request,
  { params }: { params: { slug: string } }
) {
  const { prisma } = await import("@/lib/db");
  const sale = await prisma.sale.findUnique({
    where: { slug: params.slug }
  });

  if (!sale) {
    return NextResponse.json({ error: "Sale not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const limitParam = Number.parseInt(searchParams.get("limit") ?? "10", 10);
  const offsetParam = Number.parseInt(searchParams.get("offset") ?? "0", 10);
  const maxEntries = 100;
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), maxEntries)
    : 10;
  const offset = Number.isFinite(offsetParam)
    ? Math.max(offsetParam, 0)
    : 0;
  const remaining = Math.max(0, maxEntries - offset);
  const take = Math.min(limit, remaining);

  if (take <= 0) {
    return NextResponse.json([]);
  }

  const rows = await prisma.transfer.groupBy({
    by: ["from"],
    where: { saleId: sale.id },
    _sum: { amount: true },
    _count: { _all: true },
    orderBy: { _sum: { amount: "desc" } },
    skip: offset,
    take
  });

  const leaderboard = rows.map((row) => ({
    address: row.from,
    totalAmount: row._sum.amount?.toString() ?? "0",
    txCount: row._count._all ?? 0
  }));

  return NextResponse.json(leaderboard);
}
