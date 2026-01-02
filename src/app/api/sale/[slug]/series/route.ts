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
  const bucket = searchParams.get("bucket") ?? "5m";

  if (bucket !== "5m") {
    return NextResponse.json(
      { error: "Only 5m buckets are supported" },
      { status: 400 }
    );
  }

  const fromTsParam = searchParams.get("fromTs");
  const toTsParam = searchParams.get("toTs");

  const fallbackFrom = sale.startTs;
  const fallbackTo = sale.endTs;

  const parseBigintParam = (value: string | null, fallback: bigint) => {
    if (!value) return fallback;
    try {
      return BigInt(value);
    } catch {
      return fallback;
    }
  };

  const fromTs = parseBigintParam(fromTsParam, fallbackFrom);
  const toTs = parseBigintParam(toTsParam, fallbackTo);

  const start = fromTs < 0n ? 0n : fromTs;
  const end = toTs < start ? start : toTs;

  const buckets = await prisma.bucket5m.findMany({
    where: {
      saleId: sale.id,
      bucketStartTs: {
        gte: start,
        lte: end
      }
    },
    orderBy: { bucketStartTs: "asc" }
  });

  return NextResponse.json(
    buckets.map((bucketRow) => ({
      bucketStartTs: Number(bucketRow.bucketStartTs),
      amount: bucketRow.amount.toString(),
      txCount: bucketRow.txCount
    }))
  );
}
