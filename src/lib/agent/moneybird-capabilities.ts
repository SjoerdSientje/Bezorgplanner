/**
 * Moneybird-mogelijkheden voor de planning-agent:
 * curated map uit onze wrappers + optioneel fetch van officiële docs (whitelist).
 */

const MONEYBIRD_DOCS_WHITELIST = [
  "https://developer.moneybird.com/api/sales_invoices/",
  "https://developer.moneybird.com/api/contacts/",
  "https://developer.moneybird.com/api/estimates/",
  "https://developer.moneybird.com/api/products/",
] as const;

/** Wat de Bezorgplanner-koppeling vandaag wél kan (via moneybird.ts). */
export const MONEYBIRD_APP_CAPABILITIES = `
Onze Moneybird-koppeling (samenvatting):
- Contacten: zoeken/aanmaken op e-mail (Shopify-orders, reparaties).
- Sales invoices: aanmaken/bijwerken vanuit Shopify-orders; draft sync; credits/refunds; serienummer/referenties.
- Factuur versturen per e-mail: PATCH send_invoice (delivery_method Email) — wrappers sendSalesInvoiceByEmail / sendReparatieSalesInvoice.
- Reparatie: upsertReparatieSalesInvoice, sendReparatieSalesInvoice; ophaal: conceptofferte (estimate) bij winkelafhaal; factureer estimate → factuur.
- PDF downloaden van sales invoice.
- Producten upsert vanuit Shopify.
- Webhooks voor betalingsstatus e.d.

Agent-tools:
- maak_moneybird_factuur: conceptfactuur voor bestaande reparatie- of Shopify-order (regels uit order); optioneel ook_versturen.
- stuur_moneybird_factuur: bestaande conceptfactuur per e-mail versturen.

Beperkingen:
- Geen vrije facturen zonder Bezorgplanner-order.
- Geen vrije Moneybird-API-calls buiten de tools.
- MP/winkel-orders: meestal niet via de agent.
`.trim();

function isAllowedDocsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    if (u.hostname !== "developer.moneybird.com") return false;
    return MONEYBIRD_DOCS_WHITELIST.some(
      (base) => url === base || url.startsWith(base)
    );
  } catch {
    return false;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Raadpleeg Moneybird: altijd app-capabilities; optioneel docs-pagina ophalen.
 */
export async function raadpleegMoneybirdApi(params: {
  vraag: string;
  docsUrl?: string | null;
}): Promise<string> {
  const parts: string[] = [
    MONEYBIRD_APP_CAPABILITIES,
    "",
    `Vraag van gebruiker: ${params.vraag.trim() || "(geen)"}`,
  ];

  const url = String(params.docsUrl ?? "").trim();
  if (url) {
    if (!isAllowedDocsUrl(url)) {
      parts.push(
        "",
        `Docs-URL geweigerd (niet op whitelist). Toegestaan o.a.: ${MONEYBIRD_DOCS_WHITELIST.join(", ")}`
      );
      return parts.join("\n");
    }
    try {
      const res = await fetch(url, {
        headers: { Accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        parts.push("", `Docs ophalen mislukt: HTTP ${res.status}`);
      } else {
        const html = await res.text();
        const text = stripHtml(html).slice(0, 6000);
        parts.push("", `Uittreksel officiële docs (${url}):`, text);
      }
    } catch (e) {
      parts.push(
        "",
        `Docs ophalen mislukt: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  } else {
    parts.push(
      "",
      "Geen docsUrl meegegeven. Standaard sales invoices docs:",
      MONEYBIRD_DOCS_WHITELIST[0],
      "Roep opnieuw aan met docsUrl als je officiële endpoint-details nodig hebt (bijv. send_invoice)."
    );
  }

  return parts.join("\n");
}

export { MONEYBIRD_DOCS_WHITELIST };
