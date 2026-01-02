import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function normalizeAddress(value: string) {
  return value.trim().toLowerCase();
}

async function main() {
  const slug = process.env.SALE_SLUG ?? "infinex-inx";
  const chainId = Number.parseInt(process.env.CHAIN_ID ?? "8453", 10);
  const paymentToken = normalizeAddress(
    process.env.USDC_ADDRESS ?? "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
  );
  const paymentTokenDecimals = Number.parseInt(
    process.env.USDC_DECIMALS ?? "6",
    10
  );
  const recipient = normalizeAddress(
    process.env.RECIPIENT_ADDRESS ?? "0x0000000000000000000000000000000000000000"
  );
  const startTs = BigInt(process.env.SALE_START_TS ?? "0");
  const endTs = BigInt(process.env.SALE_END_TS ?? "0");
  const targetRaise = process.env.TARGET_RAISE
    ? new Prisma.Decimal(process.env.TARGET_RAISE)
    : null;

  const sale = await prisma.sale.upsert({
    where: { slug },
    update: {
      chainId,
      paymentToken,
      paymentTokenDecimals,
      recipient,
      startTs,
      endTs,
      targetRaise
    },
    create: {
      slug,
      chainId,
      paymentToken,
      paymentTokenDecimals,
      recipient,
      startTs,
      endTs,
      targetRaise
    }
  });

  await prisma.saleState.upsert({
    where: { saleId: sale.id },
    update: {},
    create: {
      saleId: sale.id,
      lastProcessedBlock: BigInt(0),
      totalInvested: new Prisma.Decimal(0)
    }
  });

  console.log(`Seeded sale: ${sale.slug}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
