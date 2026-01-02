import { Prisma, PrismaClient, Sale } from "@prisma/client";
import { ethers } from "ethers";
import { ERC20_ABI } from "../lib/abi";
import { bucketStart, normalizeAddress } from "../lib/utils";

export type IndexerResult = {
  saleSlug: string;
  fromBlock: number;
  toBlock: number;
  blocksScanned: number;
  newTransfers: number;
  totalAdded: string;
  durationSec: number;
  skipped?: string;
};

type IndexerRunOptions = {
  slug?: string;
  runAll?: boolean;
  prisma?: PrismaClient;
  rpcUrl?: string;
  confirmations?: number;
  reorgBufferBlocks?: number;
  logQueryRange?: number;
};

type IndexerContext = {
  prisma: PrismaClient;
  rpcUrl: string;
  confirmations: number;
  reorgBufferBlocks: number;
  logQueryRange: number;
};

const DEFAULT_LOG_QUERY_RANGE = 2000;

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

function parseIntSafe(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  toBlock: number,
  logQueryRange: number
) {
  const logs: ethers.Log[] = [];
  if (fromBlock > toBlock) return logs;

  for (let start = fromBlock; start <= toBlock; start += logQueryRange) {
    const end = Math.min(toBlock, start + logQueryRange - 1);
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

async function indexSale(sale: Sale, ctx: IndexerContext): Promise<IndexerResult> {
  const startedAt = Date.now();

  const state = await ctx.prisma.saleState.upsert({
    where: { saleId: sale.id },
    update: {},
    create: {
      saleId: sale.id,
      lastProcessedBlock: BigInt(0),
      totalInvested: new Prisma.Decimal(0)
    }
  });

  const provider = new ethers.JsonRpcProvider(ctx.rpcUrl, sale.chainId);
  const latestBlock = await provider.getBlockNumber();
  const safeBlock = Math.max(0, latestBlock - ctx.confirmations);
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

  let fromBlock = Math.max(lastProcessedBlock - ctx.reorgBufferBlocks, 0);
  fromBlock = Math.max(fromBlock, startBlockGuess);

  const tokenAddress = normalizeAddress(sale.paymentToken);
  const recipient = normalizeAddress(sale.recipient);

  if (!ethers.isAddress(tokenAddress)) {
    return {
      saleSlug: sale.slug,
      fromBlock,
      toBlock: safeBlock,
      blocksScanned: 0,
      newTransfers: 0,
      totalAdded: "0",
      durationSec: Math.round((Date.now() - startedAt) / 1000),
      skipped: `Invalid payment token address: ${sale.paymentToken}`
    };
  }

  if (!ethers.isAddress(recipient)) {
    return {
      saleSlug: sale.slug,
      fromBlock,
      toBlock: safeBlock,
      blocksScanned: 0,
      newTransfers: 0,
      totalAdded: "0",
      durationSec: Math.round((Date.now() - startedAt) / 1000),
      skipped: `Invalid recipient address: ${sale.recipient}`
    };
  }

  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  const topics = [transferTopic, null, toTopicAddress(recipient)];
  const iface = new ethers.Interface(ERC20_ABI);

  const logs = await getLogsInRange(
    provider,
    tokenAddress,
    topics,
    fromBlock,
    safeBlock,
    ctx.logQueryRange
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

    const existing = await ctx.prisma.transfer.findUnique({
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
      await ctx.prisma.transfer.create({
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
      const existingBucket = bucketIncrements.get(bucketTs);
      if (existingBucket) {
        existingBucket.amount = existingBucket.amount.plus(amount);
        existingBucket.txCount += 1;
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
      ctx.prisma.bucket5m.upsert({
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
    await ctx.prisma.$transaction(bucketUpserts);
  }

  await ctx.prisma.saleState.update({
    where: { saleId: sale.id },
    data: {
      lastProcessedBlock: BigInt(safeBlock),
      lastUpdatedAt: new Date(),
      totalInvested: { increment: totalAdded }
    }
  });

  const durationSec = Math.round((Date.now() - startedAt) / 1000);
  const blocksScanned = Math.max(0, safeBlock - fromBlock + 1);

  return {
    saleSlug: sale.slug,
    fromBlock,
    toBlock: safeBlock,
    blocksScanned,
    newTransfers,
    totalAdded: totalAdded.toString(),
    durationSec
  };
}

export async function runIndexerOnce(
  options: IndexerRunOptions = {}
): Promise<IndexerResult[]> {
  const prisma =
    options.prisma ??
    new PrismaClient({
      log: ["error"]
    });
  const shouldDisconnect = !options.prisma;

  try {
    const rpcUrl = options.rpcUrl ?? process.env.RPC_URL;
    if (!rpcUrl) {
      throw new Error("RPC_URL is required to run the indexer.");
    }

    const confirmations =
      options.confirmations ??
      parseIntSafe(process.env.CONFIRMATIONS, 20);
    const reorgBufferBlocks =
      options.reorgBufferBlocks ??
      parseIntSafe(process.env.REORG_BUFFER_BLOCKS, 200);
    const logQueryRange = options.logQueryRange ?? DEFAULT_LOG_QUERY_RANGE;

    const slug = options.slug ?? process.env.SALE_SLUG ?? "infinex-inx";
    const runAll = options.runAll ?? false;

    const sales = runAll
      ? await prisma.sale.findMany()
      : await prisma.sale.findMany({ where: { slug } });

    if (sales.length === 0) {
      throw new Error(`Sale not found for slug: ${slug}`);
    }

    const results: IndexerResult[] = [];
    for (const sale of sales) {
      const result = await indexSale(sale, {
        prisma,
        rpcUrl,
        confirmations,
        reorgBufferBlocks,
        logQueryRange
      });
      results.push(result);
    }

    return results;
  } finally {
    if (shouldDisconnect) {
      await prisma.$disconnect();
    }
  }
}
