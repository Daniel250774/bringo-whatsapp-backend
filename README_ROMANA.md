# Bringo WhatsApp Backend v3 - Webhook GIFT

Această versiune adaugă:
- GET /webhook pentru verificarea Meta
- POST /webhook pentru mesaje primite
- comanda text `gift`
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
