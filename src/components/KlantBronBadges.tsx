/** Kleine bronmarkering: Moneybird-logo en/of MP. */

export function MoneybirdMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center ${className}`}
      title="Moneybird-klant"
      aria-label="Moneybird-klant"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
        <circle cx="12" cy="12" r="12" fill="#4DBA6F" />
        <path
          fill="#fff"
          d="M6.8 13.6c1.1-3.2 3.6-5.4 7.4-5.8.2 1.7 1.1 3.1 2.6 4.1-.9 1.7-2.5 2.9-4.6 3.4-1.9.4-3.8.1-5.4-1.7zm8.9-6.5c.9-.2 1.9 0 2.7.5-.6 1.1-1.5 1.9-2.7 2.3-.3-1-.5-1.9 0-2.8z"
        />
      </svg>
    </span>
  );
}

export function MpMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex h-5 items-center rounded bg-stone-100 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-stone-500 ${className}`}
      title="Marktplaats-klant"
      aria-label="Marktplaats-klant"
    >
      MP
    </span>
  );
}

export default function KlantBronBadges({
  moneybird,
  mp,
}: {
  moneybird: boolean;
  mp: boolean;
}) {
  if (!moneybird && !mp) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      {moneybird && <MoneybirdMark />}
      {mp && <MpMark />}
    </span>
  );
}
