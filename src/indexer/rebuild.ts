import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { bucketStart } from "../lib/utils";

const prisma = new PrismaClient({ log: ["error"] });

function parseSlugArg() {
  const slugArg = process.argv.find((arg) => arg.startsWith("--slug="));
  if (slugArg) {
    return slugArg.split("=")[1];
  }
  return null;
}

function shouldRunAll() {
  return process.argv.includes("--all");
}

async function rebuildSale(saleId: string, slug: string) {
  const startedAt = Date.now();
  const transfers = await prisma.transfer.findMany({
    where: { saleId },
    select: {
      blockTimestamp: true,
      amount: true
    }
  });

  const bucketMap = new Map<number, { amount: Prisma.Decimal; txCount: number }>();
  for (const transfer of transfers) {
    const bucketTs = bucketStart(Number(transfer.blockTimestamp), 300);
    const existing = bucketMap.get(bucketTs);
    if (existing) {
      existing.amount = existing.amount.plus(transfer.amount);
      existing.txCount += 1;
    } else {
      bucketMap.set(bucketTs, {
        amount: transfer.amount,
        txCount: 1
      });
    }
  }

  await prisma.bucket5m.deleteMany({ where: { saleId } });

  for (const [bucketStartTs, data] of bucketMap.entries()) {
    await prisma.bucket5m.create({
      data: {
        saleId,
        bucketStartTs: BigInt(bucketStartTs),
        amount: data.amount,
        txCount: data.txCount
      }
    });
  }

  const totalAgg = await prisma.transfer.aggregate({
    where: { saleId },
    _sum: { amount: true }
  });

  const totalInvested = totalAgg._sum.amount ?? new Prisma.Decimal(0);

  await prisma.saleState.upsert({
    where: { saleId },
    update: {
      totalInvested,
      lastUpdatedAt: new Date()
    },
    create: {
      saleId,
      lastProcessedBlock: BigInt(0),
      totalInvested
    }
  });

  const durationSec = Math.round((Date.now() - startedAt) / 1000);
  console.log(
    `[${slug}] rebuilt ${bucketMap.size} buckets, totalInvested: ${totalInvested.toString()} (${durationSec}s)`
  );
}

async function main() {
  const slugArg = parseSlugArg();
  const runAll = shouldRunAll();
  const defaultSlug = process.env.SALE_SLUG ?? "infinex-inx";
  const slug = slugArg ?? defaultSlug;

  const sales = runAll
    ? await prisma.sale.findMany()
    : await prisma.sale.findMany({ where: { slug } });

  if (sales.length === 0) {
    throw new Error(`Sale not found for slug: ${slug}`);
  }

  for (const sale of sales) {
    await rebuildSale(sale.id, sale.slug);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
