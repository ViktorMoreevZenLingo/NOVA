// The Ало wordmark with its small waveform logo. The waveform lives only in
// the brand (per DESIGN.md — no decorative waveforms elsewhere).

const WAVE_HEIGHTS = [12, 24, 34, 20, 10];

export function Wave({ className }: { className?: string }) {
  return (
    <span className={className ? `wave ${className}` : "wave"} aria-hidden="true">
      {WAVE_HEIGHTS.map((h, i) => (
        <i key={i} style={{ "--h": `${h}px` } as React.CSSProperties} />
      ))}
    </span>
  );
}

export function Brand({ label }: { label: string }) {
  return (
    <span className="brand">
      <Wave className="brand-wave" />
      <span>
        {label}
        <span className="brand-dot">.</span>
      </span>
    </span>
  );
}
