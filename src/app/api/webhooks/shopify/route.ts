import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  passesRitjesFilter,
  mapShopifyOrderToRitjesRow,
  qualifiesForPakketjes,
  pakketjesCustomerName,
  extractPakketjesLineItems,
  shopifyOrderDisplayAdres,
  shopifyOrderCreatedAt,
  type ShopifyOrder,
} from "@/lib/shopify-order";
import { allAccountEmails, shopifyWebhookOrderAppliesToOwner } from "@/lib/account";
import { loadProductDefaultItemsRules } from "@/lib/product-rules-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    const order = JSON.parse(raw) as ShopifyOrder;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: cutoffRows } = await supabase
      .from("pakketjes_owner_cutoff")
      .select("owner_email, ignore_shopify_created_before");
    const cutoffByOwner = new Map(
      (cutoffRows ?? []).map((r: { owner_email: string; ignore_shopify_created_before: string }) => [
        r.owner_email,
        r.ignore_shopify_created_before,
      ])
    );

    const shopifyOrderId = String(order.id ?? "").trim();
    const orderCreatedMs = shopifyOrderCreatedAt(order).getTime();

    if (shopifyOrderId) {
      for (const ownerEmail of allAccountEmails()) {
        if (!shopifyWebhookOrderAppliesToOwner(ownerEmail, order.note)) {
          await supabase
            .from("pakketjes_orders")
            .delete()
            .eq("owner_email", ownerEmail)
            .eq("shopify_order_id", shopifyOrderId);
          continue;
        }

        const cutoffIso = cutoffByOwner.get(ownerEmail);
        if (cutoffIso) {
          const cutoffMs = new Date(cutoffIso).getTime();
          if (orderCreatedMs < cutoffMs) {
            await supabase
              .from("pakketjes_orders")
              .delete()
              .eq("owner_email", ownerEmail)
              .eq("shopify_order_id", shopifyOrderId);
            continue;
          }
        }

        if (qualifiesForPakketjes(order)) {
          const total = parseFloat(String(order.total_price ?? 0));
          const row = {
            owner_email: ownerEmail,
            shopify_order_id: shopifyOrderId,
            order_nummer: String(order.name ?? ""),
            naam: pakketjesCustomerName(order),
            adres: shopifyOrderDisplayAdres(order),
            items: extractPakketjesLineItems(order),
            totaal_prijs: total,
            fulfillment_status: order.fulfillment_status ?? null,
          };
          const { error: pErr } = await supabase.from("pakketjes_orders").upsert(row, {
            onConflict: "owner_email,shopify_order_id",
          });
          if (pErr) {
            console.error("[webhooks/shopify] pakketjes upsert:", pErr.message);
          }
        } else {
          await supabase
            .from("pakketjes_orders")
            .delete()
            .eq("owner_email", ownerEmail)
            .eq("shopify_order_id", shopifyOrderId);
        }
      }
    }

    if (!passesRitjesFilter(order)) {
      return NextResponse.json({ ok: true, skipped: "ritjes_filter" }, { status: 200 });
    }

    const insertedOrUpdatedIds: string[] = [];
    for (const ownerEmail of allAccountEmails()) {
      if (!shopifyWebhookOrderAppliesToOwner(ownerEmail, order.note)) {
        continue;
      }
      const productRules = await loadProductDefaultItemsRules(supabase, ownerEmail);
      const row = mapShopifyOrderToRitjesRow(order, productRules);

      const { data: existing } = await supabase
        .from("orders")
        .select("id")
        .eq("owner_email", ownerEmail)
        .eq("order_id", row.order_id)
        .eq("source", "shopify")
        .maybeSingle();

      const insertRow = {
        owner_email: ownerEmail,
        source: row.source,
        type: row.type,
        status: row.status,
        order_nummer: row.order_nummer,
        naam: row.naam,
        adres_url: row.adres_url,
        bel_link: row.bel_link,
        bezorgtijd_voorkeur: row.bezorgtijd_voorkeur,
        meenemen_in_planning: row.meenemen_in_planning,
        nieuw_appje_sturen: row.nieuw_appje_sturen,
        datum_opmerking: row.datum_opmerking,
        opmerkingen_klant: row.opmerkingen_klant,
        producten: row.producten,
        bestelling_totaal_prijs: row.bestelling_totaal_prijs,
        betaald: row.betaald,
        volledig_adres: row.volledig_adres,
        telefoon_nummer: row.telefoon_nummer,
        order_id: row.order_id,
        datum: row.datum,
        aantal_fietsen: row.aantal_fietsen,
        email: row.email,
        telefoon_e164: row.telefoon_e164,
        model: row.model,
        serienummer: row.serienummer,
        mp_tags: row.mp_tags,
        line_items_json: row.line_items_json,
      };

      if (existing) {
        await supabase.from("orders").update(insertRow).eq("id", existing.id);
        insertedOrUpdatedIds.push(existing.id);
        continue;
      }

      let inserted: { id: string } | null = null;
      let insertError = null;
      const { data: d1, error: e1 } = await supabase
        .from("orders")
        .insert(insertRow)
        .select("id")
        .single();

      if (e1) {
        console.error("[webhooks/shopify] Supabase insert error:", e1.message);
        if (e1.message?.includes("line_items_json")) {
          const { line_items_json: _omit, ...rowWithoutJson } = insertRow;
          const { data: d2, error: e2 } = await supabase
            .from("orders")
            .insert(rowWithoutJson)
            .select("id")
            .single();
          inserted = d2;
          insertError = e2;
        } else {
          insertError = e1;
        }
      } else {
        inserted = d1;
      }

      if (insertError) {
        console.error("[webhooks/shopify] Definitieve insert-fout:", insertError);
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
      if (inserted?.id) insertedOrUpdatedIds.push(inserted.id);
    }

    return NextResponse.json({ ok: true, ids: insertedOrUpdatedIds }, { status: 200 });
  } catch (e) {
    console.error("[webhooks/shopify]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
