# Bringo WhatsApp Backend pentru Render

Acesta este backend-ul care va primi imaginea JPEG din aplicatia HTML si o va trimite prin WhatsApp Cloud API.

## Endpoint

POST /send-card

Primeste:
- phone = numarul destinatarului, exemplu 40743212992
- image = fisier JPEG/PNG/WebP
- caption = optional

Apoi:
1. urca imaginea la WhatsApp Cloud API;
2. primeste media_id;
3. trimite imaginea catre destinatar;
4. raspunde cu ok: true.

## Variabile de mediu in Render

In Render -> Environment adaugi:

WHATSAPP_TOKEN
PHONE_NUMBER_ID
GRAPH_API_VERSION = v23.0
CORS_ORIGIN = *

Optional:
TEMPLATE_NAME
TEMPLATE_LANGUAGE = ro
BACKEND_API_KEY

Important: WHATSAPP_TOKEN nu se pune niciodata in HTML si nu se trimite pe chat.

## Comenzi Render

Build Command:
npm install

Start Command:
npm start

## Test rapid dupa publicare

Deschizi in browser:

https://NUMELE-TAU.onrender.com/health

Daca vezi ok: true, variabilele WHATSAPP_TOKEN si PHONE_NUMBER_ID sunt setate.

## Observatie despre template

Daca destinatarul nu a scris anterior catre numarul tau WhatsApp API in ultimele 24 de ore, este posibil ca WhatsApp sa refuze mesajul imagine simplu.

Pentru trimitere initiata de firma catre angajati va fi nevoie de un template aprobat cu imagine in header.

Exemplu:
Nume template: card_bringo
Limba: ro
Header: Image
Body: Cardul tau Bringo este atasat.

Dupa aprobare setezi in Render:
TEMPLATE_NAME=card_bringo
TEMPLATE_LANGUAGE=ro
