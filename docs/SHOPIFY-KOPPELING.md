# Shopify-koppeling → Ritjes voor vandaag

## Overzicht

Nieuwe of bijgewerkte Shopify-orders worden naar de app gestuurd via een **webhook**. Alleen orders die door het **filter** gaan, komen in **Ritjes voor vandaag** (en in de `orders`-tabel in Supabase).

---

## Filter: wanneer komt een order in Ritjes voor vandaag?

Een order wordt **wel** meegenomen als aan **één** van de volgende voorwaarden wordt voldaan:

1. **`total_price` > 600** én **`tags`** bevat (hoofdletterongevoelig) **geen** `winkel`  
2. **OF** `tags` bevat `terugbrengen`  
3. **OF** `tags` bevat `ophalen`  
4. **OF** `tags` bevat `reparatie aan huis`  
5. **OF** `tags` bevat `proefrit`  

Anders wordt de order door de webhook genegeerd (geen insert/update in de app).

---

## Velden: van Shopify naar Ritjes voor vandaag

| Kolom Ritjes voor vandaag | Bron / logica |
|---------------------------|----------------|
| **Order Nummer** | `data.name` |
| **Naam** | `data.customer.first_name` + `data.customer.last_name` |
| **Adress URL** | Eerst adres: shipping_address (fallback billing_address): address1, address2, zip, city → dan URL: `https://maps.google.com/maps?q={adres}` |
| **Bel link** | Telefoon: shipping_address.phone → customer.phone → billing_address.phone → phone. Omzetten naar E.164, dan link: `https://call.ctrlq.org/{E164}` (label: "Bel {first_name}") |
| **Aankomsttijd** | Leeg (komt later) |
| **Bezorgtijd voorkeur** | Uit `data.note`: zoek naar "tijd/Tijd" → dat stuk; anders standaard `geen` |
| **Datum opmerking** | Uit `data.note`: zoek naar "datum/Datum" → dat stuk; anders standaard `vandaag` |
| **Opmerkingen klant** | Uit `data.note`: zoek naar "opmerking/Opmerking" → dat stuk; anders standaard `geen opmerking` |
| **Meenemen in planning** | Standaard `ja` (boolean true); in de app later ja/nee-dropdown |
| **Nieuw appje sturen?** | Standaard `ja` (boolean true); idem |
| **Product(en)** | Uit `data.line_items`: elk item `name`, samengevoegd (bijv. newline). Klik in de app toont lijst per product. |
| **Bestelling Totaal Prijs** | `data.total_price` |
| **Betaald?** | Als `data.financial_status` = `paid` → "betaald" (true), anders "factuur betaling aan deur" (false) |
| **Volledig adress** | Zelfde bron als Adress URL (address1, address2, zip, city) |
| **Ingevuld Telefoon nummer** | Zelfde bron als Bel link (zonder E.164-omzetting) |
| **Order ID** | `data.id` |
| **Datum** | `data.created_at` (alleen datum, bijv. YYYY-MM-DD) |
| **Aantal fietsen** | Zie hieronder |
| **Email** | `data.customer.email` → `data.email` → `data.contact_email`; anders "geen email" |
| **Nummer in E.164 formaat** | Zelfde telefoonbron, omgezet naar E.164 (NL: +31…) |
| **MP tags** | Leeg voor Shopify-orders (nieuwe kolom) |
| **Model** | Leeg voor Shopify |
| **Serienummer** | Leeg voor Shopify |

### Aantal fietsen

- Als `tags` (hoofdletterongevoelig) **één** van deze bevat: `terugbrengen`, `ophalen`, `reparatie aan huis`, `proefrit`  
  → **Aantal fietsen** = aantal regels in `data.line_items` (elk item = 1 fiets).
- Anders  
  → **Aantal fietsen** = aantal regels in `data.line_items` waar **`price` > 600** (per item).

---

## Notitie parsen (`data.note`)

Voorbeeld:  
`Tijd: tussen 12 en 17.\nOpmerking: niet aanbellen.`

- **Bezorgtijd voorkeur:** tekst na "Tijd:" → bijv. "Tussen 12:00 - 17:00" (tijden kunnen worden genormaliseerd).  
- **Datum opmerking:** als "datum/Datum" niet in de note staat → standaard `vandaag`.  
- **Opmerkingen klant:** tekst na "Opmerking:" → "Niet aanbellen."

Standaarden als een sleutelwoord niet voorkomt:  
Bezorgtijd voorkeur = `geen`, Datum opmerking = `vandaag`, Opmerkingen klant = `geen opmerking`.

---

## Webhook instellen in Shopify

1. **Shopify Admin** → **Instellingen** → **Notifications** (of **Apps and sales channels** → **Develop apps** → je app) → **Webhooks**.
2. **Webhook maken:**
   - **Event:** bv. `Order creation` en eventueel `Order update`.
   - **URL:**  
     `https://jouw-domein.nl/api/webhooks/shopify`  
     (vervang door je echte Vercel-URL, bijv. `https://bezorgplanner.vercel.app/api/webhooks/shopify`).
   - **Format:** JSON.
3. Opslaan; bij nieuwe (of geüpdatete) orders stuurt Shopify de order-payload naar deze URL.

De app ontvangt de POST, past het filter toe en schrijft alleen orders die door het filter gaan naar de `orders`-tabel (status `ritjes_vandaag`). Bestaande orders met dezelfde `order_id` + `source = 'shopify'` worden geüpdatet.

---

## Database

- Nieuwe kolom **`mp_tags`** in de tabel **`orders`** (migratie `002_add_mp_tags.sql`). Voor Shopify-orders blijft deze leeg.
- De view **Ritjes voor vandaag** toont ook **MP tags**; voor Shopify zijn die leeg.

Run in Supabase SQL Editor eerst `001_sheets.sql` (als nog niet gedaan), daarna `002_add_mp_tags.sql`.

---

## Environment

Voor de webhook-route wordt de **Supabase service role key** gebruikt als die gezet is (anders anon key), zodat inserts/updates altijd werken. Zet in `.env.local` (en in Vercel):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Optioneel: `SUPABASE_SERVICE_ROLE_KEY` (aan te maken in Supabase → Settings → API → service_role)
