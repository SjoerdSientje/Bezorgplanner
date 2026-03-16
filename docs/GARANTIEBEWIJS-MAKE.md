# Garantiebewijs — Make.com scenario

## Waarom Make.com en niet direct Google/Gmail in de app?

Google Docs en Gmail direct in de app koppelen vereist:
- OAuth2-flow (inloggen, tokens bewaren, token verversen)
- Google Cloud Console project + credentials
- Complex foutbeheer

Make.com regelt dit voor je in een visueel scenario, zonder extra code in de app.

---

## Hoe werkt het?

```
Klant haalt fiets op
  → App slaat order op in Supabase (MP orders)
  → App stuurt webhook naar Make.com met klantgegevens
      → Make.com: Google Doc aanmaken van template
      → Make.com: Doc deelbaar maken, link ophalen
      → Make.com: Email sturen via Gmail
      → Make.com: POST /api/mp-order/garantie-callback met de link
          → App slaat link op in orders.link_aankoopbewijs
```

---

## Wat Make.com ontvangt (webhook payload)

```json
{
  "order_id": "uuid van de order in Supabase",
  "order_nummer": "#MP-001",
  "naam": "Jan de Vries",
  "email": "jan@email.nl",
  "producten": "Fatbike Sport 26\" zwart",
  "serienummer": "XYZ123456",
  "totaal_prijs": 850,
  "aantal_fietsen": 1,
  "datum": "12-3-2026",
  "callback_url": "https://jouw-app.vercel.app/api/mp-order/garantie-callback"
}
```

---

## Make.com scenario opzetten

### Stap 1: Nieuw scenario aanmaken
1. Ga naar [make.com](https://www.make.com) → **Create a new scenario**
2. Eerste module: **Webhooks → Custom webhook**
3. Kopieer de URL → plak in `.env.local` als `MAKE_WEBHOOK_URL_GARANTIEBEWIJS`

### Stap 2: Google Doc aanmaken
4. Voeg module toe: **Google Docs → Create a Document from a Template**
5. Maak een Google Doc-template met variabelen, bijv.:
   - `{{naam}}`, `{{producten}}`, `{{serienummer}}`, `{{datum}}`, `{{totaal_prijs}}`
6. Zet de template-document-ID in deze module

### Stap 3: Doc delen en link ophalen
7. Voeg toe: **Google Drive → Share a File** → Anyone with link kan lezen
8. De "Web View Link" is de link die naar de klant gaat

### Stap 4: Email sturen via Gmail
9. Voeg toe: **Gmail → Send an Email**
10. Aan: `{{email}}` uit de webhook
11. Onderwerp: bijv. `Garantiebewijs Koopjefatbike — {{producten}}`
12. Body: stel de template op (komt later te bespreken)
13. Bijlage of link naar het Google Doc meesturen

### Stap 5: Link terugsturen naar de app
14. Voeg toe: **HTTP → Make a request**
    - URL: `{{callback_url}}` (uit de webhook payload)
    - Method: POST
    - Body type: JSON
    - Body:
      ```json
      {
        "order_id": "{{order_id}}",
        "link_aankoopbewijs": "{{web_view_link van stap 8}}"
      }
      ```

---

## .env.local instellen

```env
MAKE_WEBHOOK_URL_GARANTIEBEWIJS=https://hook.eu1.make.com/jouw-webhook-id
NEXT_PUBLIC_APP_URL=https://jouw-app.vercel.app
```

**Lokaal testen:** gebruik [ngrok](https://ngrok.com) om je localhost tijdelijk publiek te maken,
of test met de productie-URL op Vercel.

---

## Callback endpoint (al ingebouwd)

`POST /api/mp-order/garantie-callback`

Body:
```json
{ "order_id": "...", "link_aankoopbewijs": "https://docs.google.com/..." }
```

De link wordt opgeslagen in `orders.link_aankoopbewijs` en is daarna zichtbaar
in de MP orders-sheet.
