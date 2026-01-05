import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(
  _request: Request,
  { params }: { params: { slug: string } }
) {
  const [{ prisma }, { Prisma }] = await Promise.all([
    import("@/lib/db"),
    import("@prisma/client")
  ]);
  const sale = await prisma.sale.findUnique({
    where: { slug: params.slug },
    include: { state: true }
  });

  if (!sale) {
    return NextResponse.json({ error: "Sale not found" }, { status: 404 });
  }

  const state =
    sale.state ??
    (await prisma.saleState.create({
      data: {
        saleId: sale.id,
        lastProcessedBlock: BigInt(0),
        totalInvested: new Prisma.Decimal(0)
      }
    }));

  const nowSec = Math.floor(Date.now() / 1000);
  const hourAgo = BigInt(Math.max(0, nowSec - 3600));
  const dayAgo = BigInt(Math.max(0, nowSec - 86400));

  const capRemovedTs = sale.capRemovedTs ?? sale.startTs;

  const [hourAgg, dayAgg, participantGroups, postCapAgg] = await Promise.all([
    prisma.bucket5m.aggregate({
      where: {
        saleId: sale.id,
        bucketStartTs: { gte: hourAgo }
      },
      _sum: { amount: true }
    }),
    prisma.bucket5m.aggregate({
      where: {
        saleId: sale.id,
        bucketStartTs: { gte: dayAgo }
      },
      _sum: { amount: true }
    }),
    prisma.transfer.groupBy({
      by: ["from"],
      where: { saleId: sale.id },
      _min: { blockTimestamp: true }
    }),
    prisma.bucket5m.aggregate({
      where: {
        saleId: sale.id,
        bucketStartTs: { gte: capRemovedTs }
      },
      _sum: { amount: true }
    })
  ]);

  const investedLastHour = hourAgg._sum.amount ?? new Prisma.Decimal(0);
  const investedLastDay = dayAgg._sum.amount ?? new Prisma.Decimal(0);
  const velocityPerDayNow = investedLastHour.mul(new Prisma.Decimal(24));
  const avgVelocityPerDay = investedLastDay;
  const totalInvested = state.totalInvested ?? new Prisma.Decimal(0);
  const postCapTotal = postCapAgg._sum.amount ?? new Prisma.Decimal(0);
  const participantCount = participantGroups.length;
  const postCapNewWallets = participantGroups.filter((row) => {
    const firstSeen = row._min.blockTimestamp ?? 0n;
    return firstSeen >= capRemovedTs;
  }).length;
  const hoursSinceCap =
    Number(capRemovedTs) > 0
      ? Math.max(1, (nowSec - Number(capRemovedTs)) / 3600)
      : 0;
  const avgHourlyPostCap =
    hoursSinceCap > 0
      ? postCapTotal.div(new Prisma.Decimal(hoursSinceCap.toFixed(6)))
      : new Prisma.Decimal(0);

  const startTs = Number(sale.startTs);
  const endTs = Number(sale.endTs);
  const timeRemainingSec =
    nowSec < startTs ? startTs - nowSec : Math.max(0, endTs - nowSec);

  let percentOfTarget: number | null = null;
  if (sale.targetRaise && !sale.targetRaise.isZero()) {
    const pct = totalInvested
      .div(sale.targetRaise)
      .mul(new Prisma.Decimal(100));
    percentOfTarget = Number(pct.toFixed(2));
  }

  return NextResponse.json({
    slug: sale.slug,
    totalInvested: totalInvested.toString(),
    investedLastHour: investedLastHour.toString(),
    investedLastDay: investedLastDay.toString(),
    velocityPerDayNow: velocityPerDayNow.toString(),
    avgVelocityPerDay: avgVelocityPerDay.toString(),
    startTs,
    endTs,
    capRemovedTs: Number(capRemovedTs),
    timeRemainingSec,
    percentOfTarget,
    txCount: participantCount,
    postCapNewWallets,
    avgHourlyPostCap: avgHourlyPostCap.toString(),
    targetRaise: sale.targetRaise ? sale.targetRaise.toString() : null,
    lastUpdatedAt: state.lastUpdatedAt.toISOString()
  });
}
