# Bringo WhatsApp Backend v28

Versiune construită peste backend-ul acceptat v26. Backend-ul v27 respins nu este inclus.

## Ce face

- numai mesajul exact `Gift` declanșează trimiterea automată; sunt ignorate `gift`, `GIFT`, `Ghift`, `Ghif` și orice altă variantă;
- livrează automat primul card disponibil din ordinea salvată;
- păstrează `distributionOrder` în baza online pentru aceeași ordine pe telefon și laptop;
- oferă `POST /reorder-cards` pentru schimbarea ordinii fără regenerarea imaginilor;
- oferă `POST /notify-admin` pentru notificarea trimiterilor manuale;
- livratorul primește imaginea cardului;
- administratorul primește numai template/text, niciodată imaginea cardului;
- păstrează Supabase, backup-urile, cooldown-ul, auditul și protecția anti-replay din v26.

## Mesajul administratorului

Parametrii template-ului sunt trimiși în această ordine:

1. `{{1}}` — numele livratorului
2. `{{2}}` — telefonul livratorului
3. `{{3}}` — identificarea cardului
4. `{{4}}` — valoarea cardului
5. `{{5}}` — numărul de gifturi rămase

Body recomandat pentru template-ul Meta:

```text
{{1}} a primit un card în valoare de {{4}}.

Telefon: {{2}}
Card: {{3}}
Gifturi rămase: {{5}}
```

Fallback-ul text din backend începe tot cu numele livratorului și valoarea cardului.

## Variabile Render

Necesare pentru WhatsApp:

```text
WHATSAPP_TOKEN
PHONE_NUMBER_ID
GRAPH_API_VERSION=v23.0
WEBHOOK_VERIFY_TOKEN=bringo_verify_2026
ADMIN_COPY_PHONE=0766299556
ADMIN_TEMPLATE_NAME=admin_gift_notificare
ADMIN_TEMPLATE_LANGUAGE=ro
```

Necesare când se folosește baza online existentă:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORE_ID=bringo-main
```

Opționale:

```text
BACKEND_API_KEY
TEMPLATE_NAME
TEMPLATE_LANGUAGE=ro
MAX_INBOUND_MESSAGE_AGE_SECONDS=900
SUPABASE_BACKUPS_ENABLED=false
```

Nu sunt necesare modificări în schema Supabase față de instalarea existentă.

## Endpoint-uri principale

- `GET /health`
- `GET /state`
- `POST /sync-state`
- `POST /upsert-cards`
- `POST /reorder-cards`
- `POST /mark-card-sent`
- `POST /notify-admin`
- `GET /gift-audit`
- `GET /gift-diagnostics`
- `GET /admin-notifications`
- `GET /webhook` și `POST /webhook`

Callback Meta:

```text
https://bringo-whatsapp-backend.onrender.com/webhook
```

Pornește aplicația cu `npm start`. Versiunea raportată de `/health` și `/state` este `v28-card-order-template-only`.
