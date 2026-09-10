import { NextRequest, NextResponse } from "next/server";
import { getInventoryOwnerEmail, requireAccountEmail } from "@/lib/account";
import {
  cancelIncomingDelivery,
  isValidTrackUrl,
  parseIncomingItemInputs,
  receiveIncomingDelivery,
  uploadIncomingAttachment,
  applyIncomingNotesToProducts,
  type IncomingDeliveryItemInput,
  type IncomingDeliveryItemRow,
  type IncomingDeliveryRow,
} from "@/lib/incoming-deliveries";
import { createServerSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export type { IncomingDeliveryRow, IncomingDeliveryItemRow };

async function loadItemsForDeliveries(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  ownerEmail: string,
  deliveryIds: string[]
): Promise<Map<string, IncomingDeliveryItemRow[]>> {
  const map = new Map<string, IncomingDeliveryItemRow[]>();
  if (deliveryIds.length === 0) return map;

  const { data, error } = await supabase
    .from("incoming_delivery_items")
    .select("*")
    .eq("owner_email", ownerEmail)
    .in("delivery_id", deliveryIds)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as IncomingDeliveryItemRow[]) {
    const list = map.get(row.delivery_id) ?? [];
    list.push(row);
    map.set(row.delivery_id, list);
  }
  return map;
}

function withItems(
  rows: IncomingDeliveryRow[],
  itemsByDelivery: Map<string, IncomingDeliveryItemRow[]>
): IncomingDeliveryRow[] {
  return rows.map((r) => ({ ...r, items: itemsByDelivery.get(r.id) ?? [] }));
}

export async function GET(request: NextRequest) {
  try {
    requireAccountEmail(request);
    const ownerEmail = getInventoryOwnerEmail(request);
    const supabase = createServerSupabaseClient();

    const { data, error } = await supabase
      .from("incoming_deliveries")
      .select("*")
      .eq("owner_email", ownerEmail)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("[incoming-deliveries] GET", error);
      return NextResponse.json(
        { error: "Ophalen mislukt.", detail: error.message },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as IncomingDeliveryRow[];
    const itemsByDelivery = await loadItemsForDeliveries(
      supabase,
      ownerEmail,
      rows.map((r) => r.id)
    );
    const enriched = withItems(rows, itemsByDelivery);

    return NextResponse.json(
      {
        pending: enriched.filter((r) => r.status === "pending"),
        received: enriched.filter((r) => r.status === "received"),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ophalen mislukt." },
      { status: 500 }
    );
  }
}

async function resolveCreatePayload(request: NextRequest): Promise<{
  trackTraceUrl: string;
  expectedDelivery: string | null;
  items: IncomingDeliveryItemInput[];
  file: File | null;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const trackTraceUrl = String(form.get("track_trace_url") ?? "").trim();
    const expectedRaw = String(form.get("expected_delivery") ?? "").trim();
    const itemsRaw = form.get("items");
    let itemsParsed: unknown = [];
    if (typeof itemsRaw === "string" && itemsRaw.trim()) {
      try {
        itemsParsed = JSON.parse(itemsRaw);
      } catch {
        throw new Error("Ongeldige productregels (JSON).");
      }
    }
    const fileVal = form.get("file");
    const file = fileVal instanceof File && fileVal.size > 0 ? fileVal : null;
    return {
      trackTraceUrl,
      expectedDelivery: expectedRaw || null,
      items: parseIncomingItemInputs(itemsParsed),
      file,
    };
  }

  const body = await request.json().catch(() => ({}));
  return {
    trackTraceUrl: String(body.track_trace_url ?? "").trim(),
    expectedDelivery: String(body.expected_delivery ?? body.note ?? "").trim() || null,
    items: parseIncomingItemInputs(body.items),
    file: null,
  };
}

export async function POST(request: NextRequest) {
  try {
    requireAccountEmail(request);
    const ownerEmail = getInventoryOwnerEmail(request);
    const { trackTraceUrl, expectedDelivery, items, file } = await resolveCreatePayload(request);

    if (!isValidTrackUrl(trackTraceUrl)) {
      return NextResponse.json(
        { error: "Plak een geldige track & trace-link." },
        { status: 400 }
      );
    }

    if (file && file.size > 15 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Bijlage mag maximaal 15 MB zijn." },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();

    // Producttitels ophalen voor snapshot
    const productIds = items
      .map((i) => i.product_id)
      .filter((id): id is string => Boolean(id));
    const titleById = new Map<string, string>();
    if (productIds.length > 0) {
      const { data: products, error: prodErr } = await supabase
        .from("inventory_products")
        .select("id, title, variant_title, model_name, color_name")
        .eq("owner_email", ownerEmail)
        .in("id", productIds);
      if (prodErr) {
        return NextResponse.json({ error: prodErr.message }, { status: 500 });
      }
      for (const p of products ?? []) {
        const parts = [
          String(p.title ?? "").trim(),
          String(p.variant_title ?? "").trim(),
          [p.model_name, p.color_name].filter(Boolean).join(" ").trim(),
        ].filter(Boolean);
        titleById.set(String(p.id), parts[0] || "Voorraadregel");
      }
      for (const id of productIds) {
        if (!titleById.has(id)) {
          return NextResponse.json(
            { error: "Eén of meer voorraadregels niet gevonden." },
            { status: 400 }
          );
        }
      }
    }

    const { data: delivery, error: insertErr } = await supabase
      .from("incoming_deliveries")
      .insert({
        owner_email: ownerEmail,
        track_trace_url: trackTraceUrl,
        expected_delivery: expectedDelivery,
        status: "pending",
      })
      .select("*")
      .single();

    if (insertErr || !delivery) {
      console.error("[incoming-deliveries] POST", insertErr);
      return NextResponse.json(
        { error: "Opslaan mislukt.", detail: insertErr?.message },
        { status: 500 }
      );
    }

    const deliveryRow = delivery as IncomingDeliveryRow;

    if (file) {
      try {
        const uploaded = await uploadIncomingAttachment(supabase, {
          ownerEmail,
          deliveryId: deliveryRow.id,
          file,
          fileName: file.name || "bijlage",
          contentType: file.type || "application/octet-stream",
        });
        const { error: attErr } = await supabase
          .from("incoming_deliveries")
          .update({
            attachment_url: uploaded.url,
            attachment_name: uploaded.name,
          })
          .eq("id", deliveryRow.id);
        if (attErr) throw new Error(attErr.message);
        deliveryRow.attachment_url = uploaded.url;
        deliveryRow.attachment_name = uploaded.name;
      } catch (e) {
        await supabase.from("incoming_deliveries").delete().eq("id", deliveryRow.id);
        return NextResponse.json(
          {
            error: e instanceof Error ? e.message : "Bijlage uploaden mislukt.",
          },
          { status: 500 }
        );
      }
    }

    if (items.length > 0) {
      const itemRows = items.map((item) => {
        if (item.free_text) {
          return {
            delivery_id: deliveryRow.id,
            owner_email: ownerEmail,
            product_id: null,
            product_title: item.free_text,
            quantity: item.quantity,
            is_free_text: true,
            free_text: item.free_text,
          };
        }
        return {
          delivery_id: deliveryRow.id,
          owner_email: ownerEmail,
          product_id: item.product_id,
          product_title: titleById.get(String(item.product_id)) ?? null,
          quantity: item.quantity,
          is_free_text: false,
          free_text: null,
        };
      });

      const { data: insertedItems, error: itemsErr } = await supabase
        .from("incoming_delivery_items")
        .insert(itemRows)
        .select("*");

      if (itemsErr) {
        await supabase.from("incoming_deliveries").delete().eq("id", deliveryRow.id);
        return NextResponse.json(
          { error: "Regels opslaan mislukt.", detail: itemsErr.message },
          { status: 500 }
        );
      }

      deliveryRow.items = (insertedItems ?? []) as IncomingDeliveryItemRow[];

      try {
        await applyIncomingNotesToProducts(supabase, {
          ownerEmail,
          deliveryId: deliveryRow.id,
          trackUrl: trackTraceUrl,
          expectedDelivery,
          productIds,
        });
      } catch (e) {
        await supabase.from("incoming_deliveries").delete().eq("id", deliveryRow.id);
        return NextResponse.json(
          {
            error:
              e instanceof Error
                ? e.message
                : "Opmerkingen bijwerken mislukt.",
          },
          { status: 500 }
        );
      }
    } else {
      deliveryRow.items = [];
    }

    return NextResponse.json({ ok: true, delivery: deliveryRow });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Opslaan mislukt." },
      { status: 500 }
    );
  }
}

/** body: { id, action: "receive" | "cancel" } */
export async function PATCH(request: NextRequest) {
  try {
    requireAccountEmail(request);
    const ownerEmail = getInventoryOwnerEmail(request);
    const body = await request.json().catch(() => ({}));
    const id = String(body.id ?? "").trim();
    const action = String(body.action ?? "receive").trim().toLowerCase();
    if (!id) {
      return NextResponse.json({ error: "Ontbrekende id." }, { status: 400 });
    }
    if (action !== "receive" && action !== "cancel") {
      return NextResponse.json(
        { error: 'Ongeldige action (verwacht "receive" of "cancel").' },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const { data: delivery, error: fetchErr } = await supabase
      .from("incoming_deliveries")
      .select("*")
      .eq("id", id)
      .eq("owner_email", ownerEmail)
      .eq("status", "pending")
      .maybeSingle();

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }
    if (!delivery) {
      return NextResponse.json(
        { error: "Levering niet gevonden of niet meer onderweg." },
        { status: 404 }
      );
    }

    const { data: items, error: itemsErr } = await supabase
      .from("incoming_delivery_items")
      .select("*")
      .eq("delivery_id", id)
      .eq("owner_email", ownerEmail);

    if (itemsErr) {
      return NextResponse.json({ error: itemsErr.message }, { status: 500 });
    }

    const deliveryRow = delivery as IncomingDeliveryRow;
    const itemRows = (items ?? []) as IncomingDeliveryItemRow[];

    const result =
      action === "cancel"
        ? await cancelIncomingDelivery(supabase, {
            ownerEmail,
            delivery: deliveryRow,
            items: itemRows,
          })
        : await receiveIncomingDelivery(supabase, {
            ownerEmail,
            delivery: deliveryRow,
            items: itemRows,
          });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const { data: updated } = await supabase
      .from("incoming_deliveries")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      delivery: { ...(updated as IncomingDeliveryRow), items: itemRows },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Bijwerken mislukt." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    requireAccountEmail(request);
    const ownerEmail = getInventoryOwnerEmail(request);
    const id =
      request.nextUrl.searchParams.get("id")?.trim() ||
      String((await request.json().catch(() => ({}))).id ?? "").trim();
    if (!id) {
      return NextResponse.json({ error: "Ontbrekende id." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();

    const { data: delivery } = await supabase
      .from("incoming_deliveries")
      .select("*")
      .eq("id", id)
      .eq("owner_email", ownerEmail)
      .maybeSingle();

    if (delivery && (delivery as IncomingDeliveryRow).status === "pending") {
      const { data: items } = await supabase
        .from("incoming_delivery_items")
        .select("*")
        .eq("delivery_id", id);
      await cancelIncomingDelivery(supabase, {
        ownerEmail,
        delivery: delivery as IncomingDeliveryRow,
        items: (items ?? []) as IncomingDeliveryItemRow[],
      });
    }

    const { error } = await supabase
      .from("incoming_deliveries")
      .delete()
      .eq("id", id)
      .eq("owner_email", ownerEmail);

    if (error) {
      console.error("[incoming-deliveries] DELETE", error);
      return NextResponse.json(
        { error: "Verwijderen mislukt.", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Verwijderen mislukt." },
      { status: 500 }
    );
  }
}
