# Bringo WhatsApp Backend v4 - Webhook Gift

Această versiune adaugă:
- GET /webhook pentru verificarea Meta
- POST /webhook pentru mesaje primite
- comanda text `Gift` — acceptă și `gift` / `GIFT`
- stoc temporar/persistent local pe Render pentru carduri și angajați
- notificare către administrator cu nume livrator, dată/oră, card și gifturi rămase
- GET /state pentru sincronizarea aplicației online
- POST /sync-state pentru încărcarea cardurilor disponibile în backend

Variabile Render necesare:
WHATSAPP_TOKEN
PHONE_NUMBER_ID
GRAPH_API_VERSION=v23.0
WEBHOOK_VERIFY_TOKEN=bringo_verify_2026
ADMIN_COPY_PHONE=0766299556

Opțional:
BACKEND_API_KEY
TEMPLATE_NAME
TEMPLATE_LANGUAGE=ro

Callback URL pentru Meta:
https://bringo-whatsapp-backend.onrender.com/webhook

Verify token pentru Meta:
bringo_verify_2026

După deploy, în Meta trebuie abonat webhook-ul la câmpul/messages field `messages`.

Debug:
- /health arată lastInbound și lastGiftRequest, ca să verifici dacă webhook-ul primește mesajele.


Backend v5 state fix: /reset-state, /mark-card-sent, replaceMode=true la /sync-state, cardsSent în /health.

Backend v6 - Subscribe WABA:
- adaugă GET/POST /subscribe-waba
- folosește WABA_ID=2003039456993786 implicit sau variabila Render WABA_ID
- endpoint-ul face POST către Graph API /<WABA_ID>/subscribed_apps pentru a lega WABA la aplicația curentă.
După deploy deschide:
https://bringo-whatsapp-backend.onrender.com/subscribe-waba
