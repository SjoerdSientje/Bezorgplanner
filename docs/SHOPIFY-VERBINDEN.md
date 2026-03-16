# Shopify verbinden en testen

## Stap 1: Je app moet bereikbaar zijn op internet

Shopify kan alleen webhooks sturen naar een **publieke HTTPS-URL**. Lokaal (`localhost`) werkt niet voor webhooks.

**Opties:**

- **Vercel (aanbevolen):** Deploy je app naar Vercel. Je krijgt een URL zoals `https://bezorgplanner.vercel.app`. Die gebruik je in stap 3.
- **Andere hosting:** Zorg dat je app ergens draait met HTTPS (bijv. je eigen server of andere host).

Lokaal testen kan later met een tool zoals **ngrok** (tijdelijke publieke URL naar je laptop).

---

## Stap 2: Webhook-URL bepalen

Je webhook-URL is:

```
https://<JOUW-DOMEIN>/api/webhooks/shopify
```

Voorbeelden:

- Vercel: `https://bezorgplanner.vercel.app/api/webhooks/shopify`
- Eigen domein: `https://app.koopjefatbike.nl/api/webhooks/shopify`

---

## Stap 3: Webhook aanmaken in Shopify

1. Log in op **Shopify Admin** (je winkel).
2. Ga naar **Instellingen** (onderaan links, tandwiel).
3. Klik links op **Notificaties** (onder “Winkelinstellingen”).
4. Scroll naar beneden naar **Webhooks**.
5. Klik op **Webhook maken** (of **Create webhook**).
6. Vul in:
   - **Event:** kies **Order creation** (en eventueel **Order update** als je wijzigingen ook wilt ontvangen).
   - **Format:** **JSON**.
   - **URL:** de URL uit stap 2, bijv.  
     `https://bezorgplanner.vercel.app/api/webhooks/shopify`
7. Klik op **Opslaan**.

**Geen Webhooks-optie in Notificaties?**

Soms staat webhooks alleen bij een (custom) app:

1. Ga naar **Instellingen** → **Apps en verkoopkanalen**.
2. Klik op **App ontwikkelen** → **Een app maken** (of open een bestaande custom app).
3. Ga in de app naar **Configuratie** of **Webhooks**.
4. Voeg een **HTTPS-webhook** toe:
   - **Topic:** `orders/create` (en optioneel `orders/updated`).
   - **URL:** dezelfde URL als hierboven.

---

## Stap 4: Environment variables op je server (Vercel)

Zorg dat op je **gehoste** app (bijv. Vercel) deze variabelen staan:

| Variabele | Waar te vinden |
|-----------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Zelfde pagina |
| `SUPABASE_SERVICE_ROLE_KEY` | Zelfde pagina, onder “Project API keys” → **service_role** (geheim) |

In **Vercel:** Project → Settings → Environment Variables → voeg ze toe voor **Production** (en eventueel Preview).

---

## Stap 5: Database (Supabase)

1. Run in Supabase **SQL Editor** eerst `001_sheets.sql` (als nog niet gedaan).
2. Daarna `002_add_mp_tags.sql`.

Dan bestaan de tabel `orders` en de kolom `mp_tags`.

---

## Stap 6: Testen

### A. Testorder in Shopify

1. Maak in je Shopify-winkel een **testorder** aan:
   - Totaalbedrag **boven €600** (of gebruik een tag zoals `proefrit` of `ophalen`).
   - Vul klantgegevens in (naam, adres, telefoon, e-mail).
2. Sla de order op.
3. Shopify stuurt binnen korte tijd een webhook naar je URL.
4. Controleer in **Supabase** → **Table Editor** → tabel **orders**: er zou een nieuwe rij moeten zijn met `source = shopify` en `status = ritjes_vandaag`.
5. De pagina **Ritjes voor vandaag** in de app laadt op dit moment nog niet automatisch uit Supabase; na een volgende update wel. Tot die tijd controleer je dus in Supabase of de webhook goed werkt.

### B. Webhook-log in Shopify (als beschikbaar)

In **Instellingen** → **Notificaties** → **Webhooks** kun je soms bij je webhook **recente leveringen** of **logs** zien (geslaagd/mislukt).

### C. Foutopsporing

- **Geen order in Supabase:**  
  Controleer of de order door het **filter** gaat (totaal > €600 en geen tag `winkel`, of tag zoals `ophalen`/`terugbrengen`/`reparatie aan huis`/`proefrit`).  
  Zie `docs/SHOPIFY-KOPPELING.md` voor de exacte filterregels.

- **500-error van je app:**  
  Kijk in de **logs** van je hosting (Vercel → Project → Logs / Functions). Vaak ontbreken dan env vars (Supabase URL/key) of de `orders`-tabel/kolommen kloppen niet.

- **Webhook wordt niet aangeroepen:**  
  Controleer of de URL klopt (geen typo, HTTPS), of je app bereikbaar is en of de webhook in Shopify op “Order creation” staat.

---

## Samenvatting

| Stap | Actie |
|------|--------|
| 1 | App deployen (bijv. Vercel) met HTTPS-URL |
| 2 | Webhook-URL noteren: `https://<domein>/api/webhooks/shopify` |
| 3 | In Shopify: Notificaties → Webhooks → Webhook maken → Order creation, JSON, jouw URL |
| 4 | Op server: Supabase env vars zetten (anon + service_role) |
| 5 | In Supabase: `001_sheets.sql` en `002_add_mp_tags.sql` draaien |
| 6 | Testorder > €600 (of met tag ophalen/proefrit) aanmaken en controleren in Supabase + Ritjes voor vandaag |

Daarmee verbind je Shopify met je app en test je de koppeling.
