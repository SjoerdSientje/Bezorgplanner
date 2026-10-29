/**
 * Eenmalig: dien reparatie-orderbevestiging WhatsApp-template in bij Meta.
 *
 *   node --env-file=.env.local scripts/create-reparatie-bevestiging-template.mjs
 */

const WABA = String(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? "").trim();
const TOKEN = String(process.env.WHATSAPP_ACCESS_TOKEN ?? "").trim();
const LANGUAGE =
  String(process.env.WHATSAPP_REPARATIE_BEVESTIGING_LANGUAGE ?? "nl").trim() ||
  "nl";
const NAME =
  String(process.env.WHATSAPP_REPARATIE_BEVESTIGING_TEMPLATE ?? "").trim() ||
  "reparatie_order_bevestiging";

const BODY = `Beste {{naam}},

Bedankt voor je vertrouwen in Koopjefatbike!
We hebben je {{ordertype}} in het systeem gezet, je zult de dag voordat we komen een appje ontvangen met daarin je tijdslot en meer informatie. Tot snel!

Met vriendelijke groet,

Team Koopjefatbike`;

async function main() {
  if (!WABA || !TOKEN) {
    console.error("Mist WHATSAPP_BUSINESS_ACCOUNT_ID of WHATSAPP_ACCESS_TOKEN.");
    process.exit(1);
  }

  const listRes = await fetch(
    `https://graph.facebook.com/v22.0/${WABA}/message_templates?limit=100&fields=name,language,status,id`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
  const listJson = await listRes.json().catch(() => ({}));
  const existing = (listJson.data ?? []).find(
    (t) =>
      t.name === NAME &&
      String(t.language ?? "")
        .toLowerCase()
        .startsWith(LANGUAGE.toLowerCase().slice(0, 2))
  );
  if (existing) {
    console.log("Already exists:", {
      id: existing.id,
      status: existing.status,
      language: existing.language,
    });
    return;
  }

  const res = await fetch(
    `https://graph.facebook.com/v22.0/${WABA}/message_templates`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: NAME,
        language: LANGUAGE,
        category: "UTILITY",
        allow_category_change: true,
        parameter_format: "named",
        components: [
          {
            type: "BODY",
            text: BODY,
            example: {
              body_text_named_params: [
                { param_name: "naam", example: "Jan" },
                { param_name: "ordertype", example: "reparatie aan huis" },
              ],
            },
          },
        ],
      }),
    }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("FAIL:", json?.error?.message ?? json);
    process.exit(1);
  }
  console.log("OK:", { id: json.id, status: json.status, category: json.category });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
