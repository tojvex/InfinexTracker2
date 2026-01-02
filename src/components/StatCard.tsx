type StatCardProps = {
  label: string;
  value: string;
  helper?: string;
  accent?: boolean;
  delayMs?: number;
};

export default function StatCard({
  label,
  value,
  helper,
  accent,
  delayMs = 0
}: StatCardProps) {
  return (
    <div
      className={`rounded-2xl border border-white/60 bg-white/80 p-5 shadow-soft backdrop-blur animate-rise ${
        accent ? "ring-1 ring-tide/30" : ""
      }`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
        {label}
      </p>
      <p className="mt-3 text-2xl font-semibold text-ink">{value}</p>
      {helper ? (
        <p className="mt-2 text-xs text-slate-500">{helper}</p>
      ) : null}
    </div>
  );
}
