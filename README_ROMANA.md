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

Backend v7 - Command aliases:
- comanda automată acceptă acum atât `Gift`, cât și `Ghift`
- acceptă indiferent de litere mari/mici: gift, Gift, GIFT, ghift, Ghift, GHIFT

Backend v8 - eligibilitate și text către livrator:
- comanda Gift/Ghift trimite către livrator imaginea cu caption: "Ai primit un gift card în valoare de 2.000 lei."
- dacă livratorul este blocat/neeligibil, primește mesajul:
  "Momentan nu ești eligibil pentru primirea unui gift. Te rugăm să contactezi administratorul."

Backend v9 - valoare din fiecare gift:
- caption-ul către livrator este dinamic: "Ai primit un gift card în valoare de X lei."
- X vine din valoarea cardului sincronizată din aplicație.
- notificarea către administrator include și valoarea cardului.

Backend v10 - modificare valoare card:
- adaugă POST /update-card-value
- permite modificarea valorii pentru carduri disponibile și carduri deja trimise
- actualizează și istoricul sentLog, când cardul există acolo

Backend v11 - pauză automată livratori:
- fiecare livrator poate avea cooldownMinutes configurabil;
- după primirea unui Gift/Ghift, livratorul primește automat pauză temporară;
- dacă cere din nou prea repede, primește mesaj cu ora la care poate solicita următorul gift;
- mark-card-sent aplică pauza și pentru trimiterile manuale din aplicație;
- /state returnează employeeList cu blockedUntil, lastGiftAt și cooldownMinutes.

Backend v12 - sincronizare carduri fără ștergerea livratorilor:
- adaugă POST /upsert-cards pentru încărcarea PDF-urilor de pe telefon/laptop fără să șteargă ce există deja;
- adaugă POST /clear-cards pentru golirea doar a cardurilor, cu păstrarea livratorilor;
- /reset-state păstrează livratorii ca măsură de siguranță.

Backend v13 - backend autoritar pentru carduri:
- /upsert-cards este endpoint-ul principal pentru cardurile încărcate din PDF;
- /clear-cards șterge doar cardurile, păstrând livratorii;
- /sync-state nu mai golește accidental cardurile/livratorii când primește liste goale, decât dacă se trimite explicit allowEmptyCards/allowEmptyEmployees;
- /state returnează cardsUpdatedAt și employeesUpdatedAt pentru sincronizare între dispozitive.

Backend v14 - sincronizare directă livratori:
- adaugă POST /upsert-employees pentru adăugare/modificare/blocare/pauză livratori fără rescrierea cardurilor;
- adaugă POST /delete-employee pentru ștergere livrator fără rescrierea cardurilor;
- rezolvă blocarea/întârzierea când există multe carduri, pentru că livratorii nu mai trimit toate imaginile cardurilor la fiecare modificare.

Backend v15 - backup și protecție:
- creează backup automat înainte de fiecare salvare a bazei;
- GET /backups listează backup-urile disponibile;
- POST /restore-backup restaurează un backup;
- GET /export-store descarcă baza curentă;
- păstrează datele necunoscute la încărcarea store-ului, inclusiv timestamps.
