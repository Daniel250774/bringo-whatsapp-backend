# Bringo WhatsApp Backend v2

Modificarea principală față de v1:
- CORS permis explicit cu origin '*'
- adăugat app.options('*') pentru cereri OPTIONS/preflight
- funcționează mai bine cu HTML deschis local de pe laptop/telefon

În Render:
Build Command: npm install
Start Command: npm start

Environment Variables:
WHATSAPP_TOKEN
PHONE_NUMBER_ID
GRAPH_API_VERSION=v23.0
CORS_ORIGIN=*  (nu mai este folosit direct, dar poate rămâne)
