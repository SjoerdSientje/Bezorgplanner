export type RouteStyle = {
  num: number;
  label: string;
  border: string;
  bg: string;
  header: string;
  ring: string;
  dot: string;
};

export const ROUTE_STYLES: RouteStyle[] = [
  {
    num: 1,
    label: "Route 1",
    border: "border-l-emerald-500",
    bg: "bg-emerald-50",
    header: "text-emerald-700",
    ring: "ring-emerald-400",
    dot: "bg-emerald-500",
  },
  {
    num: 2,
    label: "Route 2",
    border: "border-l-sky-500",
    bg: "bg-sky-50",
    header: "text-sky-700",
    ring: "ring-sky-400",
    dot: "bg-sky-500",
  },
  {
    num: 3,
    label: "Route 3",
    border: "border-l-violet-500",
    bg: "bg-violet-50",
    header: "text-violet-700",
    ring: "ring-violet-400",
    dot: "bg-violet-500",
  },
  {
    num: 4,
    label: "Route 4",
    border: "border-l-amber-500",
    bg: "bg-amber-50",
    header: "text-amber-700",
    ring: "ring-amber-400",
    dot: "bg-amber-500",
  },
  {
    num: 5,
    label: "Route 5",
    border: "border-l-rose-500",
    bg: "bg-rose-50",
    header: "text-rose-700",
    ring: "ring-rose-400",
    dot: "bg-rose-500",
  },
];

export function routeStyleForIndex(index: number): RouteStyle {
  return ROUTE_STYLES[index % ROUTE_STYLES.length]!;
}
