import "dotenv/config";
import { Prisma, PrismaClient, Sale } from "@prisma/client";
import { ethers } from "ethers";
import { ERC20_ABI } from "../lib/abi";
import { bucketStart, normalizeAddress } from "../lib/utils";

const prisma = new PrismaClient({
  log: ["error"]
});

const CONFIRMATIONS = Number.parseInt(process.env.CONFIRMATIONS ?? "20", 10);
const REORG_BUFFER_BLOCKS = Number.parseInt(
  process.env.REORG_BUFFER_BLOCKS ?? "200",
  10
);
const LOG_QUERY_RANGE = 2000;

function parseIntervalArg() {
  const intervalArg = process.argv.find((arg) => arg.startsWith("--interval="));
  if (!intervalArg) return null;
  const value = Number.parseInt(intervalArg.split("=")[1], 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

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

function toTopicAddress(address: string) {
  try {
    return ethers.zeroPadValue(ethers.getAddress(address), 32);
  } catch {
    return ethers.zeroPadValue(normalizeAddress(address), 32);
  }
}

function isUniqueConstraintError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2002";
  }
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: string }).code;
    return code === "P2002";
  }
  return false;
}

async function findBlockByTimestamp(
  provider: ethers.JsonRpcProvider,
  targetTs: number,
  latestBlock: number
) {
  if (targetTs <= 0) return 0;
  let low = 0;
  let high = latestBlock;
  let best = 0;

  for (let i = 0; i < 30; i += 1) {
    const mid = Math.floor((low + high) / 2);
    const block = await provider.getBlock(mid);
    if (!block) break;

    if (block.timestamp <= targetTs) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

async function getLogsInRange(
  provider: ethers.JsonRpcProvider,
  address: string,
  topics: Array<string | string[] | null>,
  fromBlock: number,
  toBlock: number
) {
  const logs: ethers.Log[] = [];
  if (fromBlock > toBlock) return logs;

  for (let start = fromBlock; start <= toBlock; start += LOG_QUERY_RANGE) {
    const end = Math.min(toBlock, start + LOG_QUERY_RANGE - 1);
    const batch = await provider.getLogs({
      address,
      topics,
      fromBlock: start,
      toBlock: end
    });
    logs.push(...batch);
  }

  return logs;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function indexSale(sale: Sale) {
  const startedAt = Date.now();
  const rpcUrl = process.env.RPC_URL;

  if (!rpcUrl) {
    throw new Error("RPC_URL is required to run the indexer.");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl, sale.chainId);
  const state = await prisma.saleState.upsert({
    where: { saleId: sale.id },
    update: {},
    create: {
      saleId: sale.id,
      lastProcessedBlock: BigInt(0),
      totalInvested: new Prisma.Decimal(0)
    }
  });

  const latestBlock = await provider.getBlockNumber();
  const safeBlock = Math.max(0, latestBlock - CONFIRMATIONS);
  const lastProcessedBlock = Number(state.lastProcessedBlock);
  const startTs = Number(sale.startTs);
  const endTs = Number(sale.endTs);

  let startBlockGuess = 0;
  if (lastProcessedBlock === 0) {
    startBlockGuess = await findBlockByTimestamp(
      provider,
      startTs,
      safeBlock
    );
  }

  let fromBlock = Math.max(lastProcessedBlock - REORG_BUFFER_BLOCKS, 0);
  fromBlock = Math.max(fromBlock, startBlockGuess);

  const tokenAddress = normalizeAddress(sale.paymentToken);
  const recipient = normalizeAddress(sale.recipient);

  if (!ethers.isAddress(tokenAddress)) {
    console.warn(
      `[${sale.slug}] invalid payment token address: ${sale.paymentToken}`
    );
    return;
  }

  if (!ethers.isAddress(recipient)) {
    console.warn(
      `[${sale.slug}] invalid recipient address: ${sale.recipient}. ` +
        `Set RECIPIENT_ADDRESS to a valid 0x address.`
    );
    return;
  }
  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  const topics = [transferTopic, null, toTopicAddress(recipient)];
  const iface = new ethers.Interface(ERC20_ABI);

  const logs = await getLogsInRange(
    provider,
    tokenAddress,
    topics,
    fromBlock,
    safeBlock
  );

  const blockCache = new Map<number, number>();
  const seenKeys = new Set<string>();
  const bucketIncrements = new Map<
    number,
    { amount: Prisma.Decimal; txCount: number }
  >();
  let newTransfers = 0;
  let totalAdded = new Prisma.Decimal(0);

  const getBlockTimestamp = async (blockNumber: number) => {
    const cached = blockCache.get(blockNumber);
    if (cached !== undefined) return cached;
    const block = await provider.getBlock(blockNumber);
    if (!block) throw new Error(`Missing block ${blockNumber}`);
    blockCache.set(blockNumber, block.timestamp);
    return block.timestamp;
  };

  for (const log of logs) {
    const parsed = iface.parseLog({ topics: log.topics, data: log.data });
    if (!parsed) continue;
    const amountRaw = parsed.args.value as bigint;
    const amountStr = ethers.formatUnits(amountRaw, sale.paymentTokenDecimals);
    const amount = new Prisma.Decimal(amountStr);
    const blockTimestamp = await getBlockTimestamp(log.blockNumber);

    if (startTs > 0 && blockTimestamp < startTs) continue;
    if (endTs > 0 && blockTimestamp > endTs) continue;

    const logIndex =
      typeof log.index === "number"
        ? log.index
        : (log as { logIndex?: number }).logIndex ?? 0;
    const uniqueKey = `${log.transactionHash}:${logIndex}:${sale.id}`;
    if (seenKeys.has(uniqueKey)) continue;
    seenKeys.add(uniqueKey);

    const existing = await prisma.transfer.findUnique({
      where: {
        txHash_logIndex_saleId: {
          txHash: log.transactionHash,
          logIndex,
          saleId: sale.id
        }
      },
      select: { id: true }
    });

    if (existing) continue;

    try {
      await prisma.transfer.create({
        data: {
          saleId: sale.id,
          txHash: log.transactionHash,
          logIndex,
          blockNumber: BigInt(log.blockNumber),
          blockTimestamp: BigInt(blockTimestamp),
          from: normalizeAddress(parsed.args.from as string),
          to: normalizeAddress(parsed.args.to as string),
          amountRaw: amountRaw.toString(),
          amount
        }
      });

      newTransfers += 1;
      totalAdded = totalAdded.plus(amount);

      const bucketTs = bucketStart(blockTimestamp, 300);
      const existing = bucketIncrements.get(bucketTs);
      if (existing) {
        existing.amount = existing.amount.plus(amount);
        existing.txCount += 1;
      } else {
        bucketIncrements.set(bucketTs, {
          amount,
          txCount: 1
        });
      }
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        continue;
      }
      throw error;
    }
  }

  const bucketUpserts = Array.from(bucketIncrements.entries()).map(
    ([bucketStartTs, data]) =>
      prisma.bucket5m.upsert({
        where: {
          saleId_bucketStartTs: {
            saleId: sale.id,
            bucketStartTs: BigInt(bucketStartTs)
          }
        },
        update: {
          amount: { increment: data.amount },
          txCount: { increment: data.txCount }
        },
        create: {
          saleId: sale.id,
          bucketStartTs: BigInt(bucketStartTs),
          amount: data.amount,
          txCount: data.txCount
        }
      })
  );

  if (bucketUpserts.length > 0) {
    await prisma.$transaction(bucketUpserts);
  }

  await prisma.saleState.update({
    where: { saleId: sale.id },
    data: {
      lastProcessedBlock: BigInt(safeBlock),
      lastUpdatedAt: new Date(),
      totalInvested: { increment: totalAdded }
    }
  });

  const durationMs = Date.now() - startedAt;
  const blocksScanned = Math.max(0, safeBlock - fromBlock + 1);

  console.log(
    `[${sale.slug}] scanned ${blocksScanned} blocks (${fromBlock} -> ${safeBlock}), ` +
      `new transfers: ${newTransfers}, total added: ${totalAdded.toString()}, ` +
      `duration: ${Math.round(durationMs / 1000)}s`
  );
}

async function runOnce() {
  const slugArg = parseSlugArg();
  const runAll = shouldRunAll();
  const defaultSlug = process.env.SALE_SLUG ?? "infinex-inx";

  if (!runAll) {
    const slug = slugArg ?? defaultSlug;
    const sale = await prisma.sale.findUnique({ where: { slug } });

    if (!sale) {
      console.error(`Sale not found for slug: ${slug}`);
      return;
    }

    await indexSale(sale);
    return;
  }

  const sales = await prisma.sale.findMany();
  for (const sale of sales) {
    await indexSale(sale);
  }
}

async function runLoop(intervalSec: number) {
  while (true) {
    await runOnce();
    console.log(`Waiting ${intervalSec}s before next run...`);
    await sleep(intervalSec * 1000);
  }
}

const intervalSec = parseIntervalArg();
const watch = process.argv.includes("--watch") || intervalSec !== null;
const effectiveIntervalSec = intervalSec ?? 300;

const shutdown = async () => {
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const runner = watch ? runLoop(effectiveIntervalSec) : runOnce();

runner
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (!watch) {
      await prisma.$disconnect();
    }
  });
