# Bringo WhatsApp - Supabase Database Edition

## Pași

1. Creează proiect în Supabase.
2. Intră la SQL Editor și rulează `SUPABASE_SCHEMA.sql`.
3. În Render, la backend, adaugă variabilele:

```text
SUPABASE_URL=https://...supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_STORE_ID=bringo-main
```

4. Deploy backend v16.
5. Verifică:

```text
https://bringo-whatsapp-backend.onrender.com/db-status
```

Trebuie să apară:

```json
"storage": "supabase",
"supabaseConfigured": true
```

## Important

SERVICE_ROLE_KEY se pune doar în Render, niciodată în aplicația HTML.
