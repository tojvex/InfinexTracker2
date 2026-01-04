"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useCallback, useEffect, useMemo, useState } from "react";
import ProgressBar from "@/components/ProgressBar";
import StatCard from "@/components/StatCard";

type StatsResponse = {
  slug: string;
  totalInvested: string;
  investedLastHour: string;
  investedLastDay: string;
  velocityPerDayNow: string;
  avgVelocityPerDay: string;
  startTs: number;
  endTs: number;
  timeRemainingSec: number;
  percentOfTarget: number | null;
  txCount: number;
  targetRaise: string | null;
  lastUpdatedAt?: string;
};

type SeriesPoint = {
  bucketStartTs: number;
  amount: string;
  txCount: number;
};

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2
});
const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2
});
const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit"
});
const hourFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit"
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

function formatAmount(value: number, compact = false) {
  const formatter = compact ? compactFormatter : numberFormatter;
  return formatter.format(value);
}

function formatDuration(seconds: number) {
  if (seconds <= 0) return "0s";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);

  return parts.join(" ");
}

function formatDurationWithSeconds(seconds: number) {
  if (seconds <= 0) return "0s";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const parts = [];

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);

  return parts.join(" ");
}

function parseAmount(value: string | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function slugToTitle(slug: string) {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function SaleDashboard({ slug }: { slug: string }) {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [bucketView, setBucketView] = useState<"5m" | "1h">("5m");
  const [copied, setCopied] = useState(false);
  const donationAddress = "0x298BCdA0e13Df1A98e3f3f38eE5420DB32BD52CA";

  const fetchData = useCallback(async () => {
    setIsRefreshing(true);
    setError(null);

    try {
      const statsRes = await fetch(`/api/sale/${slug}/stats`, {
        cache: "no-store"
      });

      if (!statsRes.ok) {
        throw new Error("Failed to load sale stats.");
      }

      const statsJson = (await statsRes.json()) as StatsResponse;
      setStats(statsJson);

      const now = Math.floor(Date.now() / 1000);
      const start = statsJson.startTs ?? 0;
      const end = statsJson.endTs ?? 0;
      const toTs = end > 0 ? Math.min(end, now) : now;
      const fromTs =
        start > 0 ? start : Math.max(0, toTs - 86400);
      const safeFromTs = toTs < fromTs ? toTs : fromTs;

      const seriesRes = await fetch(
        `/api/sale/${slug}/series?bucket=5m&fromTs=${safeFromTs}&toTs=${toTs}`,
        { cache: "no-store" }
      );

      if (!seriesRes.ok) {
        throw new Error("Failed to load chart series.");
      }

      const seriesJson = (await seriesRes.json()) as SeriesPoint[];
      setSeries(seriesJson);
    } catch (fetchError) {
      const message =
        fetchError instanceof Error
          ? fetchError.message
          : "Unexpected error fetching sale data.";
      setError(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [slug]);

  const handleCopy = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(donationAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [donationAddress]);

  useEffect(() => {
    fetchData();
    const refreshId = setInterval(fetchData, 30000);
    return () => clearInterval(refreshId);
  }, [fetchData]);

  useEffect(() => {
    const tick = setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1000);

    return () => clearInterval(tick);
  }, []);

  const chartData = useMemo(() => {
    const base = series.map((point) => ({
      timeSec: point.bucketStartTs,
      amount: parseAmount(point.amount),
      txCount: point.txCount
    }));

    if (bucketView === "5m") {
      return base.map((point) => ({
        time: point.timeSec * 1000,
        amount: point.amount,
        txCount: point.txCount
      }));
    }

    const hourlyMap = new Map<number, { amount: number; txCount: number }>();
    for (const point of base) {
      const hourStartSec = Math.floor(point.timeSec / 3600) * 3600;
      const existing = hourlyMap.get(hourStartSec);
      if (existing) {
        existing.amount += point.amount;
        existing.txCount += point.txCount;
      } else {
        hourlyMap.set(hourStartSec, {
          amount: point.amount,
          txCount: point.txCount
        });
      }
    }

    return Array.from(hourlyMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([timeSec, data]) => ({
        time: timeSec * 1000,
        amount: data.amount,
        txCount: data.txCount
      }));
  }, [series, bucketView]);

  const hourlyTotals = useMemo(() => {
    const hourlyMap = new Map<number, number>();
    for (const point of series) {
      const hourStartSec = Math.floor(point.bucketStartTs / 3600) * 3600;
      const amount = parseAmount(point.amount);
      hourlyMap.set(hourStartSec, (hourlyMap.get(hourStartSec) ?? 0) + amount);
    }

    return Array.from(hourlyMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([hourStartSec, amount]) => ({ hourStartSec, amount }));
  }, [series]);

  const totalInvested = parseAmount(stats?.totalInvested);
  const investedLastHour = parseAmount(stats?.investedLastHour);
  const investedLastDay = parseAmount(stats?.investedLastDay);
  const velocityPerDayNow = parseAmount(stats?.velocityPerDayNow);
  const avgVelocityPerDay = parseAmount(stats?.avgVelocityPerDay);
  const targetRaise = parseAmount(stats?.targetRaise ?? undefined);
  const txCount = stats?.txCount ?? 0;
  const avgHourlyRate = useMemo(() => {
    if (!stats) return investedLastHour;
    const cutoffSec = stats.startTs + 3600;
    const currentHourStart = Math.floor(nowSec / 3600) * 3600;
    const eligible = hourlyTotals.filter(
      (point) =>
        point.hourStartSec >= cutoffSec &&
        point.hourStartSec < currentHourStart
    );
    if (eligible.length === 0) return investedLastHour;
    const total = eligible.reduce((sum, point) => sum + point.amount, 0);
    return total / eligible.length;
  }, [stats, hourlyTotals, investedLastHour, nowSec]);
  const saleDurationSec = stats
    ? stats.endTs > 0 && stats.endTs > stats.startTs
      ? stats.endTs - stats.startTs
      : 7 * 86400
    : 7 * 86400;
  const saleEndSec = stats
    ? stats.endTs > 0
      ? stats.endTs
      : stats.startTs > 0
        ? stats.startTs + saleDurationSec
        : nowSec + saleDurationSec
    : nowSec + saleDurationSec;
  const remainingSec = Math.max(0, saleEndSec - nowSec);
  const remainingHours = remainingSec / 3600;
  const optimisticProjection =
    totalInvested + avgHourlyRate * 1.5 * remainingHours;
  const realisticProjection =
    totalInvested + avgHourlyRate * remainingHours;
  const pessimisticProjection =
    totalInvested + avgHourlyRate * 0.5 * remainingHours;

  const statusLabel = stats
    ? nowSec < stats.startTs
      ? "Starts In"
      : nowSec <= stats.endTs
        ? "Ends In"
        : "Sale Ended"
    : "Loading";

  const displayName = "Infinex ICO Tracker";

  const countdownValue = stats
    ? nowSec < stats.startTs
      ? formatDurationWithSeconds(stats.startTs - nowSec)
      : nowSec <= stats.endTs
        ? formatDurationWithSeconds(stats.endTs - nowSec)
        : "0m"
    : "--";

  const lastUpdatedLabel = stats?.lastUpdatedAt
    ? dateFormatter.format(new Date(stats.lastUpdatedAt))
    : "--";
  const projectionHorizonLabel = stats
    ? formatDuration(remainingSec)
    : "--";

  return (
    <main className="relative px-6 pb-16 pt-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="space-y-4">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
              Presale Tracker
            </p>
            <div>
              <h1 className="text-3xl font-semibold text-ink md:text-4xl">
                {displayName}
              </h1>
              <p className="mt-2 max-w-xl text-sm text-slate-600">
                Live inflows for the current sale, tracked from on-chain USDC
                transfers. Powered by Base indexing every five minutes.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span className="rounded-full border border-white/70 bg-white/70 px-3 py-1">
                Last update: {lastUpdatedLabel}
              </span>
              <span className="rounded-full border border-white/70 bg-white/70 px-3 py-1">
                Auto-refresh: 30s
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={fetchData}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-soft transition hover:-translate-y-0.5 hover:shadow-glow"
            >
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <StatCard
            label="Total Invested"
            value={`${formatAmount(totalInvested)} USDC`}
            helper="All indexed transfers within the sale window"
            accent
            delayMs={0}
          />
          <StatCard
            label="Participants"
            value={formatAmount(txCount)}
            helper="Unique wallets contributing"
            delayMs={60}
          />
          <StatCard
            label="Hourly Change"
            value={`${formatAmount(investedLastHour, true)} USDC`}
            helper="Last 60 minutes"
            delayMs={120}
          />
          <StatCard
            label="Daily Change"
            value={`${formatAmount(investedLastDay, true)} USDC`}
            helper="Last 24 hours"
            delayMs={180}
          />
          <StatCard
            label="Velocity / Day"
            value={`${formatAmount(velocityPerDayNow, true)} USDC`}
            helper={`24h avg: ${formatAmount(avgVelocityPerDay, true)} USDC`}
            delayMs={240}
          />
        </section>

        {stats && stats.percentOfTarget !== null && targetRaise > 0 ? (
          <ProgressBar
            percent={stats.percentOfTarget ?? 0}
            helper={`Target: ${formatAmount(targetRaise)} USDC`}
          />
        ) : null}

        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Projection
              </p>
              <h2 className="mt-2 text-lg font-semibold text-ink">
                Projected Total by Sale End
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Based on average hourly inflow after the first hour.
              </p>
            </div>
            <span className="rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs text-slate-500">
              Avg/hr: {formatAmount(avgHourlyRate, true)} USDC
            </span>
          </div>
          <section className="grid gap-4 md:grid-cols-3">
            <StatCard
              label="Optimistic"
              value={`${formatAmount(optimisticProjection, true)} USDC`}
              helper={`Assumes +50% of avg/hr for ${projectionHorizonLabel}.`}
              accent
              delayMs={0}
            />
            <StatCard
              label="Realistic"
              value={`${formatAmount(realisticProjection, true)} USDC`}
              helper={`Assumes avg/hr continues for ${projectionHorizonLabel}.`}
              delayMs={80}
            />
            <StatCard
              label="Pessimistic"
              value={`${formatAmount(pessimisticProjection, true)} USDC`}
              helper={`Assumes -50% of avg/hr for ${projectionHorizonLabel}.`}
              delayMs={160}
            />
          </section>
        </div>

        <section className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <div className="rounded-2xl border border-white/60 bg-white/85 p-6 shadow-soft backdrop-blur animate-rise">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Momentum ({bucketView === "5m" ? "5m buckets" : "hourly"})
                </p>
                <h2 className="mt-2 text-lg font-semibold text-ink">
                  Inflow Trend
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-mist px-3 py-1 text-xs font-medium text-slate-600">
                  Sale window
                </span>
                <div className="flex items-center rounded-full border border-white/70 bg-white/80 p-1 text-xs font-medium text-slate-600">
                  <button
                    type="button"
                    onClick={() => setBucketView("5m")}
                    className={`rounded-full px-3 py-1 transition ${
                      bucketView === "5m"
                        ? "bg-ink text-white shadow-soft"
                        : "text-slate-600 hover:text-ink"
                    }`}
                  >
                    5m
                  </button>
                  <button
                    type="button"
                    onClick={() => setBucketView("1h")}
                    className={`rounded-full px-3 py-1 transition ${
                      bucketView === "1h"
                        ? "bg-ink text-white shadow-soft"
                        : "text-slate-600 hover:text-ink"
                    }`}
                  >
                    1h
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 h-72">
              {chartData.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  {isLoading ? "Loading chart..." : "No inflows yet."}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="time"
                      tickFormatter={(value) =>
                        bucketView === "1h"
                          ? hourFormatter.format(new Date(value as number))
                          : timeFormatter.format(new Date(value as number))
                      }
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(value) => formatAmount(value as number, true)}
                    />
                    <Tooltip
                      cursor={{ stroke: "#94a3b8", strokeDasharray: "3 3" }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const amount = payload[0]?.value ?? 0;
                        return (
                          <div className="rounded-lg border border-white/70 bg-white/90 px-3 py-2 text-xs shadow-soft">
                            <p className="text-slate-500">
                              {dateFormatter.format(new Date(label as number))}
                            </p>
                            <p className="mt-1 font-semibold text-ink">
                              {formatAmount(Number(amount))} USDC
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="amount"
                      stroke="#0f766e"
                      strokeWidth={2.5}
                      dot={
                        bucketView === "1h"
                          ? {
                              r: 4,
                              fill: "#0f766e",
                              fillOpacity: 0.45,
                              strokeWidth: 0
                            }
                          : false
                      }
                      activeDot={{ r: 4, fill: "#0f766e" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-white/60 bg-white/80 p-5 shadow-soft backdrop-blur animate-rise">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Status
              </p>
              <p className="mt-3 text-2xl font-semibold text-ink">{statusLabel}</p>
              <p className="mt-2 text-sm text-slate-600">
                {countdownValue}
              </p>
            </div>

            <div className="rounded-2xl border border-white/60 bg-white/80 p-5 shadow-soft backdrop-blur animate-rise">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Sale Window
              </p>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <p>
                  <span className="font-mono text-slate-500">Start:</span>{" "}
                  {stats ? dateFormatter.format(new Date(stats.startTs * 1000)) : "--"}
                </p>
                <p>
                  <span className="font-mono text-slate-500">End:</span>{" "}
                  {stats ? dateFormatter.format(new Date(stats.endTs * 1000)) : "--"}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-white/60 bg-white/80 p-5 shadow-soft backdrop-blur animate-rise">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Health
              </p>
              <div className="mt-3 text-sm text-slate-600">
                <p>Indexer updates every 5 minutes.</p>
                <p className="mt-2">
                  Data scoped to USDC transfers into the sale recipient.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <footer className="mx-auto mt-10 max-w-6xl text-center text-xs text-slate-500">
        <p>
          If you found this tracker helpful and would like to donate, you can do
          so here:
        </p>
        <button
          type="button"
          onClick={handleCopy}
          className="mt-2 inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/80 px-3 py-1 font-mono text-slate-600 shadow-soft transition hover:-translate-y-0.5 hover:text-ink"
        >
          <span>{donationAddress}</span>
          <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
            {copied ? "Copied" : "Copy"}
          </span>
        </button>
      </footer>
    </main>
  );
}
