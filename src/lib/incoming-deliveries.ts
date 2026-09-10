import type { SupabaseClient } from "@supabase/supabase-js";
import { applyInventoryMutation } from "@/lib/inventory";

export const INCOMING_DELIVERY_BUCKET = "incoming-deliveries";

export type IncomingDeliveryStatus = "pending" | "received" | "cancelled";

export type IncomingDeliveryItemRow = {
  id: string;
  delivery_id: string;
  owner_email: string;
  product_id: string | null;
  product_title: string | null;
  quantity: number;
  is_free_text: boolean;
  free_text: string | null;
  created_at: string;
};

export type IncomingDeliveryRow = {
  id: string;
  owner_email: string;
  track_trace_url: string;
  expected_delivery: string | null;
  attachment_url: string | null;
  attachment_name: string | null;
  status: IncomingDeliveryStatus;
  created_at: string;
  received_at: string | null;
  updated_at: string;
  items?: IncomingDeliveryItemRow[];
};

export type IncomingDeliveryItemInput = {
  product_id?: string | null;
  quantity: number;
  free_text?: string | null;
};

function uniqueStrings(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function isValidTrackUrl(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return s.length >= 4;
  }
}

export function buildIncomingOpmerkingBlock(
  deliveryId: string,
  trackUrl: string,
  expectedDelivery: string | null
): string {
  const lines = [
    `Inkomend ${deliveryId.slice(0, 8)}`,
    `track en trace: ${trackUrl.trim()}`,
  ];
  const expected = expectedDelivery?.trim();
  if (expected) {
    lines.push(`Verwachte levertijd: ${expected}`);
  }
  return lines.join("\n");
}

export function appendIncomingOpmerking(
  opmerking: string | null | undefined,
  block: string
): string {
  const base = String(opmerking ?? "").trim();
  return base ? `${base}\n\n${block}` : block;
}

export function stripIncomingOpmerkingBlock(
  opmerking: string | null | undefined,
  deliveryId: string,
  trackUrl?: string | null,
  expectedDelivery?: string | null
): string | null {
  let next = String(opmerking ?? "");
  if (!next.trim()) return null;

  // Nieuw multilijn-blok (exacte match)
  if (trackUrl != null && String(trackUrl).trim()) {
    const block = buildIncomingOpmerkingBlock(deliveryId, trackUrl, expectedDelivery ?? null);
    if (block && next.includes(block)) {
      next = next.split(block).join("");
      next = next.replace(/\n{3,}/g, "\n\n").trim();
      return next || null;
    }
  }

  // Fallback: blok starten met "Inkomend {shortId}"
  const shortId = deliveryId.slice(0, 8);
  const header = `Inkomend ${shortId}`;
  const headerIdx = next.indexOf(header);
  if (headerIdx !== -1) {
    const afterHeader = next.slice(headerIdx);
    const lines = afterHeader.split("\n");
    let consume = 1;
    if (lines[1]?.toLowerCase().startsWith("track en trace:")) consume = 2;
    if (consume >= 2 && lines[2]?.toLowerCase().startsWith("verwachte levertijd:")) {
      consume = 3;
    }
    const removed = lines.slice(0, consume).join("\n");
    next = next.slice(0, headerIdx) + next.slice(headerIdx + removed.length);
  }

  // Oude éénregelige / marker-variant
  const start = `[inkomend:${deliveryId}]`;
  const end = `[/inkomend:${deliveryId}]`;
  const startIdx = next.indexOf(start);
  const endIdx = next.indexOf(end);
  if (startIdx !== -1 && endIdx !== -1 && endIdx >= startIdx) {
    next = next.slice(0, startIdx) + next.slice(endIdx + end.length);
  } else if (next.includes(start)) {
    next = next
      .split("\n")
      .filter((line) => !line.includes(start))
      .join("\n");
  }

  next = next.replace(/\n{3,}/g, "\n\n").trim();
  return next || null;
}

export function parseIncomingItemInputs(raw: unknown): IncomingDeliveryItemInput[] {
  if (!Array.isArray(raw)) return [];
  const out: IncomingDeliveryItemInput[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const qty = Math.floor(Number(r.quantity));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const freeText = String(r.free_text ?? r.freeText ?? "").trim();
    const productId = String(r.product_id ?? r.productId ?? "").trim();
    if (freeText) {
      out.push({ free_text: freeText, quantity: qty, product_id: null });
    } else if (productId) {
      out.push({ product_id: productId, quantity: qty, free_text: null });
    }
  }
  return out;
}

async function patchProductOpmerking(
  supabase: SupabaseClient,
  ownerEmail: string,
  productId: string,
  opmerking: string | null
): Promise<void> {
  const { error } = await supabase
    .from("inventory_products")
    .update({ opmerking })
    .eq("id", productId)
    .eq("owner_email", ownerEmail);
  if (error) {
    throw new Error(error.message);
  }
}

/** Voeg T&T / verwachte levertijd toe aan opmerking van gekoppelde voorraadregels. */
export async function applyIncomingNotesToProducts(
  supabase: SupabaseClient,
  params: {
    ownerEmail: string;
    deliveryId: string;
    trackUrl: string;
    expectedDelivery: string | null;
    productIds: string[];
  }
): Promise<void> {
  const unique = uniqueStrings(params.productIds.filter(Boolean));
  if (unique.length === 0) return;

  const block = buildIncomingOpmerkingBlock(
    params.deliveryId,
    params.trackUrl,
    params.expectedDelivery
  );

  const { data, error } = await supabase
    .from("inventory_products")
    .select("id, opmerking")
    .eq("owner_email", params.ownerEmail)
    .in("id", unique);

  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const id = String(row.id);
    const next = appendIncomingOpmerking(row.opmerking as string | null, block);
    await patchProductOpmerking(supabase, params.ownerEmail, id, next);
  }
}

/** Verwijder T&T / verwachte levertijd-blok uit opmerkingen. */
export async function clearIncomingNotesFromProducts(
  supabase: SupabaseClient,
  params: {
    ownerEmail: string;
    deliveryId: string;
    trackUrl?: string | null;
    expectedDelivery?: string | null;
    productIds: string[];
  }
): Promise<void> {
  const unique = uniqueStrings(params.productIds.filter(Boolean));
  if (unique.length === 0) return;

  const { data, error } = await supabase
    .from("inventory_products")
    .select("id, opmerking")
    .eq("owner_email", params.ownerEmail)
    .in("id", unique);

  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const id = String(row.id);
    const next = stripIncomingOpmerkingBlock(
      row.opmerking as string | null,
      params.deliveryId,
      params.trackUrl,
      params.expectedDelivery
    );
    await patchProductOpmerking(supabase, params.ownerEmail, id, next);
  }
}

export async function receiveIncomingDelivery(
  supabase: SupabaseClient,
  params: {
    ownerEmail: string;
    delivery: IncomingDeliveryRow;
    items: IncomingDeliveryItemRow[];
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const productItems = params.items.filter((i) => !i.is_free_text && i.product_id);
  const productIds = productItems.map((i) => String(i.product_id));
  const bikeRestocks: Array<{ productTitle: string; quantityAdded: number }> = [];

  for (const item of productItems) {
    const result = await applyInventoryMutation(supabase, {
      ownerEmail: params.ownerEmail,
      productId: String(item.product_id),
      mutationType: "inkomend",
      quantity: item.quantity,
      source: "handmatig",
      note: `Inkomende levering ontvangen`,
      orderReference: params.delivery.id,
      skipBikeRestockAlert: true,
    });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    if (result.bikeRestock) {
      bikeRestocks.push(result.bikeRestock);
    }
  }

  if (bikeRestocks.length > 0) {
    try {
      const { notifyInventoryBikeRestockAlert } = await import("@/lib/whatsapp");
      const wa = await notifyInventoryBikeRestockAlert(bikeRestocks);
      if (!wa.ok) {
        console.warn("[incoming-deliveries] fiets-aanvul WhatsApp mislukt:", wa.error);
      }
    } catch (e) {
      console.warn("[incoming-deliveries] fiets-aanvul WhatsApp fout:", e);
    }
  }

  try {
    await clearIncomingNotesFromProducts(supabase, {
      ownerEmail: params.ownerEmail,
      deliveryId: params.delivery.id,
      trackUrl: params.delivery.track_trace_url,
      expectedDelivery: params.delivery.expected_delivery,
      productIds,
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Opmerkingen opschonen mislukt.",
    };
  }

  const receivedAt = new Date().toISOString();
  const { error } = await supabase
    .from("incoming_deliveries")
    .update({ status: "received", received_at: receivedAt })
    .eq("id", params.delivery.id)
    .eq("owner_email", params.ownerEmail)
    .eq("status", "pending");

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function cancelIncomingDelivery(
  supabase: SupabaseClient,
  params: {
    ownerEmail: string;
    delivery: IncomingDeliveryRow;
    items: IncomingDeliveryItemRow[];
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const productIds = params.items
    .filter((i) => !i.is_free_text && i.product_id)
    .map((i) => String(i.product_id));

  try {
    await clearIncomingNotesFromProducts(supabase, {
      ownerEmail: params.ownerEmail,
      deliveryId: params.delivery.id,
      trackUrl: params.delivery.track_trace_url,
      expectedDelivery: params.delivery.expected_delivery,
      productIds,
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Opmerkingen opschonen mislukt.",
    };
  }

  const { error } = await supabase
    .from("incoming_deliveries")
    .update({ status: "cancelled" })
    .eq("id", params.delivery.id)
    .eq("owner_email", params.ownerEmail)
    .eq("status", "pending");

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function uploadIncomingAttachment(
  supabase: SupabaseClient,
  params: {
    ownerEmail: string;
    deliveryId: string;
    file: File | Blob;
    fileName: string;
    contentType: string;
  }
): Promise<{ url: string; name: string }> {
  await supabase.storage
    .createBucket(INCOMING_DELIVERY_BUCKET, { public: true })
    .catch(() => {});

  const safeName = params.fileName.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 120) || "bijlage";
  const path = `${params.ownerEmail}/${params.deliveryId}/${Date.now()}-${safeName}`;

  const buffer = Buffer.from(await params.file.arrayBuffer());
  const { error } = await supabase.storage.from(INCOMING_DELIVERY_BUCKET).upload(path, buffer, {
    contentType: params.contentType || "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error(error.message);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ?? "";
  return {
    url: `${supabaseUrl}/storage/v1/object/public/${INCOMING_DELIVERY_BUCKET}/${path}`,
    name: safeName,
  };
}
