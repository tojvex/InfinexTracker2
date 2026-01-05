type StatCardProps = {
  label: string;
  value: string;
  helper?: string;
  accent?: boolean;
  highlight?: boolean;
  delayMs?: number;
};

export default function StatCard({
  label,
  value,
  helper,
  accent,
  highlight,
  delayMs = 0
}: StatCardProps) {
  const highlightClass = "border-amber-200/80 bg-amber-50/70 ring-1 ring-amber-300/60";
  const accentClass = "ring-1 ring-tide/30";

  return (
    <div
      className={`rounded-2xl border border-white/60 bg-white/80 p-5 shadow-soft backdrop-blur transition hover:-translate-y-0.5 hover:shadow-glow animate-rise ${
        highlight ? highlightClass : accent ? accentClass : ""
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
