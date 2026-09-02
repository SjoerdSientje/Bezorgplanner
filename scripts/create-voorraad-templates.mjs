/**
 * Eenmalig: dien voorraad WhatsApp-templates in bij Meta.
 *
 * Gebruik:
 *   WHATSAPP_BUSINESS_ACCOUNT_ID=... WHATSAPP_ACCESS_TOKEN=... node scripts/create-voorraad-templates.mjs
 *
 * Of zet die vars in .env.local / .env.vercel.local en:
 *   node --env-file=.env.local scripts/create-voorraad-templates.mjs
 */

const WABA = String(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? "").trim();
const TOKEN = String(process.env.WHATSAPP_ACCESS_TOKEN ?? "").trim();
const LANGUAGE = String(process.env.WHATSAPP_VOORRAAD_ALERT_LANGUAGE ?? "nl").trim() || "nl";

const SPECS = [
  {
    name: "voorraad_laag_3",
    bodyText: "De voorraad van {{productnaam}} is laag (3).",
    exampleProduct: "Fatbike Zwart",
  },
  {
    name: "voorraad_uitverkocht",
    bodyText: "Waarschuwing! {{productnaam}} is uitverkocht, bestel bij!",
    exampleProduct: "Fatbike Zwart",
  },
];

async function main() {
  if (!WABA || !TOKEN) {
    console.error(
      "Mist WHATSAPP_BUSINESS_ACCOUNT_ID of WHATSAPP_ACCESS_TOKEN.\n" +
        "Haal ze uit Vercel env of Meta Developers en run opnieuw."
    );
    process.exit(1);
  }

  for (const spec of SPECS) {
    const res = await fetch(
      `https://graph.facebook.com/v22.0/${WABA}/message_templates`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: spec.name,
          language: LANGUAGE,
          category: "UTILITY",
          allow_category_change: true,
          parameter_format: "named",
          components: [
            {
              type: "BODY",
              text: spec.bodyText,
              example: {
                body_text_named_params: [
                  { param_name: "productnaam", example: spec.exampleProduct },
                ],
              },
            },
          ],
        }),
      }
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`FAIL ${spec.name}:`, json?.error?.message ?? json);
    } else {
      console.log(`OK ${spec.name}:`, { id: json.id, status: json.status });
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
