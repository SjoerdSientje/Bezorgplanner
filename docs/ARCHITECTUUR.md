# Bezorgplanner – Architectuur & aanbeveling

## Aanbeveling: Next.js + Supabase op Vercel

### Waarom deze stack?

| Onderdeel | Keuze | Reden |
|-----------|--------|--------|
| **Framework** | **Next.js 14 (App Router)** | Eén codebase voor desktop + mobiel, native op Vercel, API routes voor Routific/Shopify, server components waar nodig. |
| **Database** | **Supabase** | PostgreSQL, realtime updates (handig voor live planning), auth en Row Level Security (RLS) inbegrepen. |
| **Hosting** | **Vercel** | Eenvoudige deploy van Next.js, serverless, goede DX en gratis tier om te starten. |

Je “sheets” worden **tabellen in Supabase**; de logica (wie gaat waarheen, wanneer) zit in de app en in de database.

---

## Database: sheets → Supabase-tabellen

Conceptueel 1-op-1 met je sheets, maar dan als echte tabellen met relaties.

### Voorgestelde tabellen

1. **`orders`** (vervangt o.a. “Ritjes voor vandaag”)  
   - Alle binnenkomende orders (Shopify + MP).  
   - Kolommen o.a.: `id`, `source` (shopify | mp), `type` (verkoop | reparatie_ophalen | reparatie_terugbrengen | reparatie_deur | mp_winkel), `klant_*`, `producten`, `bedrag`, `bezorgdatum`, `meenemen_morgen` (ja/nee), `created_at`, enz.

2. **`planning_slots`** of **`bezorgplanner`**  
   - Geaccepteerde planning voor een dag: welke orders, in welke volgorde, met tijdslot.  
   - Kolommen o.a.: `id`, `datum`, `order_id`, `volgorde`, `tijdslot_start`, `tijdslot_eind`, `status` (gepland | onderweg | afgerond), `created_at`.

3. **`bezorgde_orders`**  
   - Orders die via de normale bezorgflow zijn afgerond (Shopify).  
   - Kan een **view** of gekopieerde rijen zijn uit `orders` + extra velden (naam bezorger, betaalmethode, afgerond_at). Of een aparte tabel met `order_id` + afrond-gegevens.

4. **`mp_orders`**  
   - MP-orders (bezorgd én winkelverkoop).  
   - Zelfde idee: of uitbreiding van `orders` met `destination` (bezorgplanner vs mp_orders), of aparte tabel/label.

5. **`settings`** (vervangt sheet “Starttijd”)  
   - Eén rij of key-value: o.a. `default_start_tijd` (bijv. `10:30`), eventueel per-dag override.

6. **`afrondingen`** (optioneel, als je afrond-gegevens apart wilt)  
   - `order_id`, `planning_slot_id`, `bezorger_naam`, `betaalmethode`, `afgerond_at`.

Je kunt beginnen met **orders**, **planning_slots**, **bezorgde_orders**, **mp_orders** en **settings**, en afrondingen eerst in `planning_slots` of in `orders` bijhouden.

---

## App-structuur (hoog niveau)

```
/app
  /page.tsx                 # Dashboard / start
  /ritjes-vandaag/          # Lijst orders (≈ Ritjes voor vandaag)
  /planning/                # Planning bekijken, accepteren, opnieuw genereren
  /bezorgde-orders/         # Overzicht bezorgde orders
  /mp-orders/               # MP-orders + formulier voor nieuwe MP-order
  /instellingen/            # o.a. starttijd
  /bezorger/                # Route + afronden (mobiel-vriendelijk)
/api
  /routific/                # Route ophalen / opnieuw genereren
  /shopify/                 # Webhook voor nieuwe orders (optioneel)
  /mp-formulier/            # MP-order aanmaken
/lib
  supabase.ts               # Supabase client
  routific.ts               # Routific API
/components
  ...
```

- **Vercel**: `vercel deploy` of koppeling met Git; Next.js wordt automatisch gebuild.
- **Supabase**: project aanmaken, connection string en anon/key in env (lokaal + Vercel). RLS aanzetten voor security.

---

## Volgende stappen

1. **Supabase-project** aanmaken en bovenstaande tabellen (of een eerste versie) aanmaken.  
2. **Next.js-project** in deze repo opzetten (App Router, TypeScript, Supabase client).  
3. **Eén “sheet” per scherm** uitwerken: eerst Ritjes voor vandaag (CRUD op `orders`), dan planning, dan bezorger-flow, dan MP-formulier en MP-orders.  
4. **Routific** in een API-route aanroepen en resultaat in `planning_slots` wegschrijven.  
5. **Shopify** (later): webhook die nieuwe orders in `orders` zet.

Als je wilt, kan ik in dezelfde repo een **Next.js-boilerplate** met Supabase en bovenstaande mappenstructuur voor je uitschrijven (incl. voorbeeld-queries en env-voorbeeld), zodat je direct op Vercel kunt deployen en de “sheets” stap voor stap in de app kunt nabouwen.  
Als je zegt “ja, scaffold de app”, dan maak ik dat concreet (bestanden + korte instructies in een README).