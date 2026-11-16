/** Kleine bronmarkering: Moneybird-logo en/of MP. */

export function MoneybirdMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex h-5 items-center justify-center ${className}`}
      title="Moneybird-klant"
      aria-label="Moneybird-klant"
    >
      {/* Officieel Moneybird-beeldmerk (huisstijl). */}
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
