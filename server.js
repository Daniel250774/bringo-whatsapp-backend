const express = require("express");
const cors = require("cors");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;
const GRAPH_VERSION = process.env.GRAPH_API_VERSION || "v23.0";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const TEMPLATE_NAME = process.env.TEMPLATE_NAME || "";
const TEMPLATE_LANGUAGE = process.env.TEMPLATE_LANGUAGE || "ro";
const BACKEND_API_KEY = process.env.BACKEND_API_KEY || "";
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || "bringo_verify_2026";
const ADMIN_COPY_PHONE = process.env.ADMIN_COPY_PHONE || "0766299556";
const STORE_PATH = process.env.STORE_PATH || path.join(__dirname, "data", "bringo_store.json");

const corsOptions = {
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key"],
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "100mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
});

function defaultStore() {
  return {
    cards: [],
    employees: [],
    sentLog: [],
    processedMessageIds: []
  };
}

function loadStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return defaultStore();
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    return {
      cards: Array.isArray(parsed.cards) ? parsed.cards : [],
      employees: Array.isArray(parsed.employees) ? parsed.employees : [],
      sentLog: Array.isArray(parsed.sentLog) ? parsed.sentLog : [],
      processedMessageIds: Array.isArray(parsed.processedMessageIds) ? parsed.processedMessageIds : []
    };
  } catch (e) {
    console.error("loadStore error", e.message);
    return defaultStore();
  }
}

function saveStore(store) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  if (Array.isArray(store.processedMessageIds) && store.processedMessageIds.length > 300) {
    store.processedMessageIds = store.processedMessageIds.slice(-300);
  }
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function requireConfig() {
  const missing = [];
  if (!WHATSAPP_TOKEN) missing.push("WHATSAPP_TOKEN");
  if (!PHONE_NUMBER_ID) missing.push("PHONE_NUMBER_ID");
  return missing;
}

function normalizePhone(value) {
  let phone = String(value || "").replace(/\D/g, "");
  if (phone.startsWith("00")) phone = phone.slice(2);
  if (phone.startsWith("0")) phone = "40" + phone.slice(1);
  if (phone.length === 9 && phone.startsWith("7")) phone = "40" + phone;
  return phone;
}

function displayPhone(phone) {
  const p = normalizePhone(phone);
  if (/^40\d{9}$/.test(p)) return "0" + p.slice(2);
  return String(phone || "");
}

function checkApiKey(req, res, next) {
  if (!BACKEND_API_KEY) return next();
  const sent = req.headers["x-api-key"] || req.body?.apiKey || req.query?.apiKey;
  if (sent !== BACKEND_API_KEY) {
    return res.status(401).json({ ok: false, error: "API key invalid sau lipsa." });
  }
  next();
}

function dataUrlToBuffer(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i);
  if (!match) throw new Error("Imagine invalidă în stocul backend.");
  return {
    mimetype: match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase(),
    buffer: Buffer.from(match[2], "base64")
  };
}

async function uploadMediaBuffer(buffer, mimetype, filename) {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimetype || "image/jpeg");
  form.append("file", buffer, {
    filename: filename || "card.jpg",
    contentType: mimetype || "image/jpeg"
  });

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/media`;
  const response = await axios.post(url, form, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      ...form.getHeaders()
    },
    maxBodyLength: Infinity
  });

  if (!response.data || !response.data.id) {
    throw new Error("WhatsApp nu a returnat media_id.");
  }
  return response.data.id;
}

async function uploadMediaToWhatsApp(file) {
  return uploadMediaBuffer(
    file.buffer,
    file.mimetype || "image/jpeg",
    file.originalname || "card.jpg"
  );
}

async function sendImageMessage(to, mediaId, caption) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "image",
    image: { id: mediaId }
  };

  if (caption) payload.image.caption = caption;

  const response = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    }
  });

  return response.data;
}

async function sendTextMessage(to, text) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: {
      preview_url: false,
      body: text
    }
  };

  const response = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    }
  });

  return response.data;
}

async function sendTemplateWithImage(to, mediaId) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: TEMPLATE_NAME,
      language: { code: TEMPLATE_LANGUAGE },
      components: [
        {
          type: "header",
          parameters: [
            { type: "image", image: { id: mediaId } }
          ]
        }
      ]
    }
  };

  const response = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    }
  });

  return response.data;
}

function publicCards(cards) {
  return (cards || []).map(c => ({
    id: c.id,
    code: c.code,
    last4: c.last4,
    value: c.value,
    fileBase: c.fileBase,
    status: c.status || "available",
    sentAt: c.sentAt || "",
    sentTo: c.sentTo || "",
    sentPhone: c.sentPhone || "",
    sentSource: c.sentSource || ""
  }));
}

function findEmployeeByPhone(store, phone) {
  const normalized = normalizePhone(phone);
  return (store.employees || []).find(emp => normalizePhone(emp.phone) === normalized) || null;
}

function getFirstAvailableCard(store) {
  return (store.cards || []).find(c => (c.status || "available") !== "sent" && c.imageDataUrl);
}

function remainingAvailableCount(store) {
  return (store.cards || []).filter(c => (c.status || "available") !== "sent").length;
}

function buildAdminCaption(employee, card, remainingAfter) {
  const now = new Date();
  const dateText = now.toLocaleDateString("ro-RO", { timeZone: "Europe/Bucharest" });
  const timeText = now.toLocaleTimeString("ro-RO", {
    timeZone: "Europe/Bucharest",
    hour: "2-digit",
    minute: "2-digit"
  });
  const cardLabel = card.last4 || (card.code ? String(card.code).slice(-4) : card.fileBase || "-");

  return (
    "Gift trimis către livrator:\n" +
    employee.name + "\n\n" +
    "Telefon livrator: " + (employee.displayPhone || displayPhone(employee.phone)) + "\n" +
    "Data: " + dateText + "\n" +
    "Ora: " + timeText + "\n" +
    "Card: " + cardLabel + "\n" +
    "Gifturi rămase: " + remainingAfter
  );
}

async function handleGiftRequest(from, messageId) {
  const store = loadStore();

  if (messageId && store.processedMessageIds.includes(messageId)) {
    return { ok: true, duplicate: true };
  }

  const employee = findEmployeeByPhone(store, from);
  if (!employee) {
    await sendTextMessage(from, "Numărul tău nu este înregistrat pentru primirea de gifturi.");
    if (messageId) store.processedMessageIds.push(messageId);
    saveStore(store);
    return { ok: false, reason: "employee_not_found" };
  }

  if (employee.blocked) {
    await sendTextMessage(from, "Nu poți primi gift momentan. Contactează administratorul.");
    if (messageId) store.processedMessageIds.push(messageId);
    saveStore(store);
    return { ok: false, reason: "employee_blocked" };
  }

  const card = getFirstAvailableCard(store);
  if (!card) {
    await sendTextMessage(from, "Nu mai sunt gifturi disponibile momentan.");
    try {
      await sendTextMessage(
        normalizePhone(ADMIN_COPY_PHONE),
        "Livratorul " + employee.name + " a cerut gift, dar nu mai sunt gifturi disponibile."
      );
    } catch (e) {
      console.error("admin no-stock notification failed:", e.response?.data || e.message);
    }
    if (messageId) store.processedMessageIds.push(messageId);
    saveStore(store);
    return { ok: false, reason: "no_cards" };
  }

  const image = dataUrlToBuffer(card.imageDataUrl);
  const mediaId = await uploadMediaBuffer(image.buffer, image.mimetype, (card.fileBase || "card") + ".jpg");

  await sendImageMessage(from, mediaId, "");

  const sentAt = new Date().toISOString();
  card.status = "sent";
  card.sentAt = sentAt;
  card.sentTo = employee.name;
  card.sentPhone = employee.displayPhone || displayPhone(employee.phone);
  card.sentSource = "whatsapp_gift_request";

  const remainingAfter = remainingAvailableCount(store);

  const adminCaption = buildAdminCaption(employee, card, remainingAfter);
  try {
    await sendImageMessage(normalizePhone(ADMIN_COPY_PHONE), mediaId, adminCaption);
  } catch (e) {
    console.error("admin copy failed:", e.response?.data || e.message);
  }

  store.sentLog.push({
    id: card.id,
    code: card.code,
    last4: card.last4,
    fileBase: card.fileBase,
    sentAt,
    sentTo: employee.name,
    sentPhone: employee.displayPhone || displayPhone(employee.phone),
    sentSource: "whatsapp_gift_request",
    remainingAfter
  });

  if (messageId) store.processedMessageIds.push(messageId);
  saveStore(store);

  return { ok: true, employee: employee.name, card: card.fileBase, remainingAfter };
}

app.get("/", (req, res) => {
  const store = loadStore();
  res.json({
    ok: true,
    service: "Bringo WhatsApp Backend",
    version: "v3-webhook-gift",
    configured: requireConfig().length === 0,
    mode: TEMPLATE_NAME ? "template_with_image" : "direct_image_message",
    cardsAvailable: remainingAvailableCount(store),
    employees: store.employees.length
  });
});

app.get("/health", (req, res) => {
  const missing = requireConfig();
  const store = loadStore();
  res.json({
    ok: missing.length === 0,
    missing,
    phoneNumberIdPresent: Boolean(PHONE_NUMBER_ID),
    tokenPresent: Boolean(WHATSAPP_TOKEN),
    templateName: TEMPLATE_NAME || null,
    webhookVerifyTokenPresent: Boolean(WEBHOOK_VERIFY_TOKEN),
    adminCopyPhone: ADMIN_COPY_PHONE,
    cardsAvailable: remainingAvailableCount(store),
    cardsTotal: store.cards.length,
    employees: store.employees.length
  });
});

app.get("/state", checkApiKey, (req, res) => {
  const store = loadStore();
  res.json({
    ok: true,
    cardsAvailable: remainingAvailableCount(store),
    cardsTotal: store.cards.length,
    employees: store.employees.length,
    cards: publicCards(store.cards),
    sentLog: store.sentLog || []
  });
});

app.post("/sync-state", checkApiKey, async (req, res) => {
  try {
    const store = loadStore();
    const now = new Date().toISOString();

    const incomingEmployees = Array.isArray(req.body.employees) ? req.body.employees : [];
    store.employees = incomingEmployees
      .map(emp => {
        const phone = normalizePhone(emp.phone);
        return {
          name: String(emp.name || "").trim().toUpperCase(),
          phone,
          displayPhone: emp.displayPhone || displayPhone(phone),
          color: emp.color || "#16a34a",
          blocked: Boolean(emp.blocked)
        };
      })
      .filter(emp => emp.name && /^40\d{9}$/.test(emp.phone));

    const incomingCards = Array.isArray(req.body.cards) ? req.body.cards : [];
    const existingByCode = new Map((store.cards || []).filter(c => c.code).map(c => [String(c.code), c]));
    const nextCards = [];

    for (const raw of incomingCards) {
      const code = String(raw.code || "").trim();
      if (!code) continue;

      const existing = existingByCode.get(code);
      const incomingStatus = raw.status === "sent" ? "sent" : "available";

      const base = {
        id: String(raw.id || code),
        code,
        last4: String(raw.last4 || code.slice(-4)),
        value: String(raw.value || ""),
        fileBase: String(raw.fileBase || code.slice(-4)),
        imageDataUrl: raw.imageDataUrl || existing?.imageDataUrl || "",
        syncedAt: now
      };

      if (existing && existing.status === "sent") {
        nextCards.push({
          ...existing,
          ...base,
          status: "sent",
          imageDataUrl: existing.imageDataUrl || base.imageDataUrl
        });
      } else {
        nextCards.push({
          ...base,
          status: incomingStatus,
          sentAt: raw.sentAt || "",
          sentTo: raw.sentTo || "",
          sentPhone: raw.sentPhone || "",
          sentSource: raw.sentSource || (incomingStatus === "sent" ? "manual_html" : "")
        });
      }
    }

    const nextCodes = new Set(nextCards.map(c => String(c.code)));
    for (const existing of store.cards || []) {
      if (existing.status === "sent" && existing.code && !nextCodes.has(String(existing.code))) {
        nextCards.push(existing);
      }
    }

    store.cards = nextCards;
    saveStore(store);

    res.json({
      ok: true,
      cardsAvailable: remainingAvailableCount(store),
      cardsTotal: store.cards.length,
      employees: store.employees.length
    });
  } catch (err) {
    console.error("sync-state error", err);
    res.status(500).json({ ok: false, error: err.message || "Eroare sync-state" });
  }
});

app.post("/send-card", checkApiKey, upload.single("image"), async (req, res) => {
  try {
    const missing = requireConfig();
    if (missing.length) {
      return res.status(500).json({ ok: false, error: "Lipsesc variabile Render: " + missing.join(", ") });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ ok: false, error: "Lipseste campul image cu fisierul JPEG." });
    }

    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.mimetype || "")) {
      return res.status(400).json({ ok: false, error: "Fisierul trebuie sa fie imagine JPEG/PNG/WebP." });
    }

    const to = normalizePhone(req.body.phone);
    if (!/^40\d{9}$/.test(to)) {
      return res.status(400).json({ ok: false, error: "Numar invalid. Exemplu valid: 40743212992." });
    }

    const caption = String(req.body.caption || "").trim();
    const mediaId = await uploadMediaToWhatsApp(file);

    const result = TEMPLATE_NAME
      ? await sendTemplateWithImage(to, mediaId)
      : await sendImageMessage(to, mediaId, caption);

    return res.json({
      ok: true,
      to,
      mediaId,
      mode: TEMPLATE_NAME ? "template_with_image" : "direct_image_message",
      whatsapp: result
    });
  } catch (err) {
    const meta = err.response?.data;
    console.error("send-card error:", meta || err.message || err);
    return res.status(500).json({
      ok: false,
      error: meta?.error?.message || err.message || "Eroare necunoscuta",
      meta
    });
  }
});

// Meta verifică endpoint-ul webhook prin GET.
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// Meta trimite mesajele primite către acest POST.
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body || {};
    const entries = body.entry || [];

    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const value = change.value || {};
        const messages = value.messages || [];

        for (const msg of messages) {
          if (msg.type !== "text") continue;

          const text = String(msg.text?.body || "").trim().toLowerCase();
          const from = normalizePhone(msg.from);
          const messageId = msg.id || "";

          if (text === "gift") {
            const result = await handleGiftRequest(from, messageId);
            console.log("gift request result:", result);
          }
        }
      }
    }
  } catch (err) {
    console.error("webhook processing error:", err.response?.data || err.message || err);
  }
});

app.listen(PORT, () => {
  console.log(`Bringo WhatsApp Backend v3 webhook gift running on port ${PORT}`);
});
