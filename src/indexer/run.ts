import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { IndexerResult, runIndexerOnce } from "./indexer";

const prisma = new PrismaClient({
  log: ["error"]
});

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

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function logResult(result: IndexerResult) {
  if (result.skipped) {
    console.warn(`[${result.saleSlug}] skipped: ${result.skipped}`);
    return;
  }

  console.log(
    `[${result.saleSlug}] scanned ${result.blocksScanned} blocks ` +
      `(${result.fromBlock} -> ${result.toBlock}), new transfers: ` +
      `${result.newTransfers}, total added: ${result.totalAdded}, ` +
      `duration: ${result.durationSec}s`
  );
}

async function runOnce() {
  const slugArg = parseSlugArg();
  const runAll = shouldRunAll();
  const defaultSlug = process.env.SALE_SLUG ?? "infinex-inx";
  const slug = slugArg ?? defaultSlug;

  const results = await runIndexerOnce({
    prisma,
    slug,
    runAll
  });

  results.forEach(logResult);
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
