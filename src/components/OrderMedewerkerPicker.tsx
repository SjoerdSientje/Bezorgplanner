"use client";

import {
  ORDER_MEDEWERKERS,
  type OrderMedewerker,
} from "@/lib/order-medewerker";

type Props = {
  value: string;
  onChange: (value: OrderMedewerker | "") => void;
  className?: string;
};

export default function OrderMedewerkerPicker({
  value,
  onChange,
  className,
}: Props) {
  return (
    <fieldset className={className}>
      <legend className="text-sm font-medium text-koopje-black">
        Wie maakt deze order aan? *
      </legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {ORDER_MEDEWERKERS.map((naam) => (
          <button
            key={naam}
            type="button"
            onClick={() => onChange(naam)}
            className={`rounded-full px-3 py-1.5 text-sm transition ${
              value === naam
                ? "bg-koopje-orange text-white"
                : "bg-stone-100 text-koopje-black hover:bg-stone-200"
            }`}
          >
            {naam}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
