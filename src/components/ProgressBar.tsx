type ProgressBarProps = {
  percent: number;
  helper?: string;
};

export default function ProgressBar({ percent, helper }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, percent));

  return (
    <div className="rounded-2xl border border-white/60 bg-white/80 p-5 shadow-soft backdrop-blur transition hover:-translate-y-0.5 hover:shadow-glow animate-rise">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-500">
        <span>Target Progress</span>
        <span className="font-mono text-slate-600">{clamped.toFixed(2)}%</span>
      </div>
      <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-200/70">
        <div
          className="h-full bg-gradient-to-r from-tide via-tide to-flare shadow-glow"
          style={{ width: `${clamped}%` }}
        />
      </div>
      {helper ? (
        <p className="mt-2 text-xs text-slate-500">{helper}</p>
      ) : null}
    </div>
  );
}
