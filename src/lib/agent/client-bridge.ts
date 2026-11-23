/**
 * Client-side brug tussen pagina's (bijv. Ritjes) en de globale PlanningAgentChat.
 */

import type { RitjesOrderFromApi } from "@/lib/ritjes-mapping";

export const PLANNING_AGENT_ACTION_EVENT = "planning-agent:action";

export type PlanningAgentActionDetail = {
  action: "slotsUpdated" | "invoiceSent" | string;
};

type RitjesCtx = {
  orders: RitjesOrderFromApi[];
  routeVertrektijden: string;
};

let ritjesCtx: RitjesCtx = { orders: [], routeVertrektijden: "" };

export function setPlanningAgentRitjesContext(
  orders: RitjesOrderFromApi[],
  routeVertrektijden?: string
) {
  ritjesCtx = {
    orders: orders ?? [],
    routeVertrektijden: routeVertrektijden ?? ritjesCtx.routeVertrektijden,
  };
}

export function clearPlanningAgentRitjesContext() {
  ritjesCtx = { orders: [], routeVertrektijden: "" };
}

export function getPlanningAgentRitjesContext(): RitjesCtx {
  return ritjesCtx;
}

export function dispatchPlanningAgentAction(
  action: PlanningAgentActionDetail["action"]
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<PlanningAgentActionDetail>(PLANNING_AGENT_ACTION_EVENT, {
      detail: { action },
    })
  );
}
