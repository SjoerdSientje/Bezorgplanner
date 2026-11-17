/** Kleine bronmarkering: Moneybird / MP / Snelstart. */

export function MoneybirdMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex h-5 items-center justify-center ${className}`}
      title="Moneybird-klant"
      aria-label="Moneybird-klant"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brands/moneybird-mark.svg"
        alt=""
        width={20}
        height={14}
        className="h-3.5 w-auto"
        draggable={false}
      />
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

export function SnelstartMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex h-5 max-w-[4.5rem] items-center justify-center ${className}`}
      title="Snelstart-klant (vóór Moneybird)"
      aria-label="Snelstart-klant"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brands/snelstart-logo.svg"
        alt=""
        width={72}
        height={13}
        className="h-3 w-auto max-w-[4.5rem] object-contain object-left"
        draggable={false}
      />
    </span>
  );
}

export default function KlantBronBadges({
  moneybird,
  mp,
  snelstart = false,
}: {
  moneybird: boolean;
  mp: boolean;
  snelstart?: boolean;
}) {
  // MB wint: geen Snelstart-badge naast Moneybird (samengevoegd).
  const showSnelstart = snelstart && !moneybird;
  if (!moneybird && !mp && !showSnelstart) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      {moneybird && <MoneybirdMark />}
      {showSnelstart && <SnelstartMark />}
      {mp && <MpMark />}
    </span>
  );
}
