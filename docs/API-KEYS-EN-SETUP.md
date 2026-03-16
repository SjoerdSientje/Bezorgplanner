# API-keys en setup

Overzicht van alle keys en waar je ze vult in (lokaal + Vercel). Daarna: GitHub en Vercel koppelen.

---

## 1. Alle API-keys / environment variables

### Nu in gebruik

| Variabele | Nodig voor | Waar te vinden | Lokaal | Vercel |
|-----------|------------|----------------|--------|--------|
| **NEXT_PUBLIC_SUPABASE_URL** | Database, app | Supabase → **Settings** → **API** → Project URL | ✅ | ✅ |
| **NEXT_PUBLIC_SUPABASE_ANON_KEY** | Database, app | Zelfde pagina → **anon** public | ✅ | ✅ |
| **SUPABASE_SERVICE_ROLE_KEY** | Shopify-webhook, server-only | Zelfde pagina → **service_role** (geheim) | ✅ | ✅ |

### Toegevoegd voor functionaliteit

| Variabele | Nodig voor | Waar te vinden | Lokaal | Vercel |
|-----------|------------|----------------|--------|--------|
| **OPENAI_API_KEY** | AI/denkwerk in de app | [platform.openai.com](https://platform.openai.com) → API keys | ✅ | ✅ |
| **ROUTIFIC_API_TOKEN** | Snelste route berekening | Routific-dashboard / account | ✅ | ✅ |
| **MAKE_WEBHOOK_URL_PLANNING_APPROVED** | Klantberichten na goedkeuring planning | Make.com → scenario met Webhook-module → URL kopiëren | ✅ | ✅ |

### Optioneel later

| Variabele | Nodig voor |
|-----------|------------|
| **SHOPIFY_WEBHOOK_SECRET** | HMAC-verificatie Shopify-webhook |
| Gmail / WhatsApp Business | Alleen als je *niet* via Make werkt; vereisen OAuth en extra config |

---

## 2. Klantberichten: Make-webhook vs direct Gmail/WhatsApp

**Aanbeveling: eerst een POST naar een Make.com-webhook.**

| Aanpak | Voordelen | Nadelen |
|--------|-----------|---------|
| **Make (webhook)** | Eén POST vanuit de app met payload (bv. planning goedgekeurd + lijst orders + tijdsloten). Make doet Gmail, WhatsApp Business, templates, retries. Geen OAuth of API-keys voor Gmail/WA in de app. Wijzigingen in teksten/flows in Make zonder redeploy. | Je hebt een Make-account en een scenario nodig. |
| **Direct Gmail + WhatsApp in de app** | Alles in één codebase. | Gmail: OAuth2, tokens bewaren, refresh. WhatsApp Business: goedkeuring Meta, API-complexiteit. Meer code en onderhoud in de app. |

**Praktisch:** In de app alleen een aanroep na “Planning goedgekeurd”, bijvoorbeeld:

- `POST MAKE_WEBHOOK_URL_PLANNING_APPROVED`  
- Body: bv. `{ "planning_id", "datum", "orders": [{ "naam", "email", "telefoon", "tijdslot", "aankoopbewijs_url", ... }] }`

In Make: Webhook ontvangen → voor elke order Gmail (aankoopbewijs, tijdslot) + WhatsApp (bericht/review-request) doen. Later eenvoudig uitbreiden (SMS, andere templates) zonder app-code aan te passen.

Als je later toch alles in de app wilt: dan kun je Gmail API en WhatsApp Business API toevoegen en de benodigde keys/scopes in dit doc en in `.env.example` zetten.

---

## 3. Waar vul je ze in?

### Lokaal (development)

1. Kopieer `.env.example` naar `.env.local` in de projectmap.
2. Vul in `.env.local` de echte waarden in (zie hierboven).
3. **Belangrijk:** `.env.local` staat in `.gitignore` en wordt nooit gecommit.

### Vercel (productie)

1. Ga naar [vercel.com](https://vercel.com) → je project.
2. **Settings** → **Environment Variables**.
3. Voeg elke variabele toe (Name + Value).
4. Kies **Production** (en eventueel Preview) en save.

---

## 4. Keys per dienst

### Supabase

1. Ga naar [app.supabase.com](https://app.supabase.com) en open je project.
2. Links: **Settings** (tandwiel) → **API**.
3. Noteer:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **Project API keys**:
     - **anon public** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     - **service_role** (klik “Reveal”) → `SUPABASE_SERVICE_ROLE_KEY`  
       ⚠️ service_role nooit in frontend of publieke code; alleen op de server (o.a. webhook).

### OpenAI
- [platform.openai.com](https://platform.openai.com) → **API keys** → Create new secret key.
- Gebruik voor denkwerk/AI in de app (bv. samenvattingen, suggesties). Bewaar als `OPENAI_API_KEY`; alleen server-side gebruiken.

### Routific
- Inloggen op Routific → **API** of **Settings** → API token kopiëren.
- Gebruik voor route-optimalisatie; bewaar als `ROUTIFIC_API_TOKEN`.

### Make.com (webhook)
- Scenario aanmaken → **Webhooks** → **Custom webhook** → URL kopiëren.
- Die URL als `MAKE_WEBHOOK_URL_PLANNING_APPROVED` in env zetten. De app stuurt na goedkeuring planning een POST met de benodigde data.

---

## 5. GitHub als tussenstap (aanbevolen)

**Waarom GitHub?**

- Code staat in de cloud en is gekoppeld aan Vercel.
- Elke push naar de main-branch kan automatisch een nieuwe deploy triggeren.
- Je hebt één plek voor versiebeheer en deploy.

**Stappen:**

1. **Git initialiseren** (als nog niet gedaan) in je projectmap:
   ```bash
   cd /pad/naar/Bezorgplanner
   git init
   git add .
   git commit -m "Initial commit Bezorgplanner"
   ```

2. **Repository op GitHub aanmaken**
   - Ga naar [github.com](https://github.com) → **New repository**.
   - Naam bijv. `bezorgplanner` (of `koopjefatbike-bezorgplanner`).
   - Geen README/ .gitignore toevoegen (je hebt die lokaal al).
   - Create repository.

3. **Lokaal aan GitHub koppelen**
   - GitHub toont iets als: “push an existing repository from the command line”.
   ```bash
   git remote add origin https://github.com/JOUW-GEBRUIKERSNAAM/bezorgplanner.git
   git branch -M main
   git push -u origin main
   ```
   (Vervang de URL door de jouwe.)

4. **Vercel koppelen aan GitHub**
   - Ga naar [vercel.com](https://vercel.com) → **Add New** → **Project**.
   - Kies **Import Git Repository** → koppel je GitHub-account als dat nog niet is gedaan.
   - Selecteer de repo `bezorgplanner`.
   - Bij **Configure Project**: root map is goed, framework = Next.js.
   - Voeg onder **Environment Variables** meteen de drie Supabase-variabelen toe (zie hierboven).
   - Deploy.

Daarna: elke `git push` naar `main` zorgt voor een nieuwe deploy. De webhook-URL voor Shopify wordt dan:  
`https://<jouw-vercel-project>.vercel.app/api/webhooks/shopify`.

---

## 6. Checklist

- [ ] `.env.local` aangemaakt met Supabase URL + anon key + service_role key
- [ ] Supabase: `001_sheets.sql` en `002_add_mp_tags.sql` gedraaid
- [ ] (Optioneel) GitHub-repo aangemaakt en code gepusht
- [ ] Vercel-project aangemaakt, gekoppeld aan GitHub, env vars ingevuld
- [ ] Shopify-webhook ingesteld op `https://<vercel-url>/api/webhooks/shopify`

Als dit allemaal staat, kun je de Shopify-koppeling testen met een testorder.
