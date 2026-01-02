import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { slug: string } }
) {
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

  const [hourAgg, dayAgg] = await Promise.all([
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
    })
  ]);

  const investedLastHour = hourAgg._sum.amount ?? new Prisma.Decimal(0);
  const investedLastDay = dayAgg._sum.amount ?? new Prisma.Decimal(0);
  const velocityPerDayNow = investedLastHour.mul(new Prisma.Decimal(24));
  const avgVelocityPerDay = investedLastDay;
  const totalInvested = state.totalInvested ?? new Prisma.Decimal(0);

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
    timeRemainingSec,
    percentOfTarget,
    targetRaise: sale.targetRaise ? sale.targetRaise.toString() : null,
    lastUpdatedAt: state.lastUpdatedAt.toISOString()
  });
}
