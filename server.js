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
const EMPLOYEE_GIFT_CAPTION = process.env.EMPLOYEE_GIFT_CAPTION || "Ai primit un gift card în valoare de 2.000 lei.";
const WABA_ID = process.env.WABA_ID || "2003039456993786";
const DEFAULT_GIFT_COOLDOWN_MINUTES = parseInt(process.env.DEFAULT_GIFT_COOLDOWN_MINUTES || "60", 10);
const STORE_PATH = process.env.STORE_PATH || path.join(__dirname, "data", "bringo_store.json");
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(STORE_PATH), "backups");
const MAX_BACKUPS = parseInt(process.env.MAX_BACKUPS || "80", 10);
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const SUPABASE_STORE_ID = process.env.SUPABASE_STORE_ID || "bringo-main";
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

function supabaseBaseUrl() {
  return String(SUPABASE_URL || "").replace(/\/+$/, "");
}

function supabaseRestUrl(table, query = "") {
  return `${supabaseBaseUrl()}/rest/v1/${table}${query ? `?${query}` : ""}`;
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra
  };
}

function supabaseErrorMessage(err) {
  const status = err.response?.status;
  const data = err.response?.data;
  const code = err.code ? ` ${err.code}` : "";
  const dataText = data ? ` ${typeof data === "string" ? data : JSON.stringify(data)}` : "";
  return `${err.message || String(err)}${code}${status ? ` HTTP ${status}` : ""}${dataText}`.trim();
}

async function supabaseGetStoreRow() {
  const query = `store_key=eq.${encodeURIComponent(SUPABASE_STORE_ID)}&select=store_key,data,updated_at&limit=1`;
  const response = await axios.get(supabaseRestUrl("bringo_app_store", query), {
    headers: supabaseHeaders(),
    timeout: 20000
  });
  return Array.isArray(response.data) && response.data.length ? response.data[0] : null;
}

async function supabaseUpsertStore(data) {
  const response = await axios.post(
    supabaseRestUrl("bringo_app_store", "on_conflict=store_key"),
    {
      store_key: SUPABASE_STORE_ID,
      data,
      updated_at: new Date().toISOString()
    },
    {
      headers: supabaseHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
      timeout: 30000
    }
  );
  return response.data;
}

async function supabaseInsertBackup(reason, data) {
  const response = await axios.post(
    supabaseRestUrl("bringo_app_backups"),
    {
      store_key: SUPABASE_STORE_ID,
      reason: safeBackupReason(reason),
      data,
      created_at: new Date().toISOString()
    },
    {
      headers: supabaseHeaders({ Prefer: "return=minimal" }),
      timeout: 30000
    }
  );
  return response.data;
}

async function supabaseListBackups(limit = 50) {
  const safeLimit = Math.min(parseInt(String(limit || "50"), 10) || 50, 200);
  const query =
    `store_key=eq.${encodeURIComponent(SUPABASE_STORE_ID)}` +
    `&select=id,reason,created_at,data` +
    `&order=created_at.desc` +
    `&limit=${safeLimit}`;
  const response = await axios.get(supabaseRestUrl("bringo_app_backups", query), {
    headers: supabaseHeaders(),
    timeout: 20000
  });
  return Array.isArray(response.data) ? response.data : [];
}

async function supabaseGetBackupById(id) {
  const query =
    `store_key=eq.${encodeURIComponent(SUPABASE_STORE_ID)}` +
    `&id=eq.${encodeURIComponent(id)}` +
    `&select=id,data,created_at` +
    `&limit=1`;
  const response = await axios.get(supabaseRestUrl("bringo_app_backups", query), {
    headers: supabaseHeaders(),
    timeout: 20000
  });
  return Array.isArray(response.data) && response.data.length ? response.data[0] : null;
}

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
    processedMessageIds: [],
    lastInbound: null,
    lastGiftRequest: null,
    cardsUpdatedAt: "",
    employeesUpdatedAt: ""
  };
}

function normalizeStore(parsed) {
  const base = defaultStore();
  const store = { ...base, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  store.cards = Array.isArray(store.cards) ? store.cards : [];
  store.employees = Array.isArray(store.employees) ? store.employees : [];
  store.sentLog = Array.isArray(store.sentLog) ? store.sentLog : [];
  store.processedMessageIds = Array.isArray(store.processedMessageIds) ? store.processedMessageIds : [];
  store.lastInbound = store.lastInbound || null;
  store.lastGiftRequest = store.lastGiftRequest || null;
  store.cardsUpdatedAt = store.cardsUpdatedAt || "";
  store.employeesUpdatedAt = store.employeesUpdatedAt || "";
  return store;
}

function loadLocalStoreOnly() {
  try {
    if (!fs.existsSync(STORE_PATH)) return defaultStore();
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    return normalizeStore(parsed);
  } catch (e) {
    console.error("loadLocalStoreOnly error", e.message);
    return defaultStore();
  }
}

let memoryStore = null;
let storeLoaded = false;
let storeLoadPromise = null;
let persistQueue = Promise.resolve();
let lastDatabaseError = null;
let lastDatabaseLoadedAt = "";
let lastDatabaseSavedAt = "";

function loadStore() {
  if (memoryStore) return normalizeStore(memoryStore);
  return loadLocalStoreOnly();
}

function safeBackupReason(reason) {
  return String(reason || "save").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 50) || "save";
}

function backupFilename(reason) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${stamp}__${safeBackupReason(reason)}.json`;
}

function listBackupFiles() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
      .filter(name => name.endsWith(".json"))
      .map(name => {
        const fullPath = path.join(BACKUP_DIR, name);
        const stat = fs.statSync(fullPath);
        return { name, fullPath, mtimeMs: stat.mtimeMs, sizeBytes: stat.size };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch (e) {
    console.error("listBackupFiles error", e.message);
    return [];
  }
}

function cleanupOldBackups() {
  const max = Number.isFinite(MAX_BACKUPS) && MAX_BACKUPS > 0 ? MAX_BACKUPS : 80;
  const files = listBackupFiles();
  for (const file of files.slice(max)) {
    try { fs.unlinkSync(file.fullPath); } catch (e) { console.error("backup cleanup error", e.message); }
  }
}

function createStoreBackup(reason = "save") {
  try {
    if (!fs.existsSync(STORE_PATH)) return null;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const target = path.join(BACKUP_DIR, backupFilename(reason));
    fs.copyFileSync(STORE_PATH, target);
    cleanupOldBackups();
    return target;
  } catch (e) {
    console.error("createStoreBackup error", e.message);
    return null;
  }
}

async function ensureStoreLoaded() {
  if (storeLoaded) return memoryStore;
  if (storeLoadPromise) return storeLoadPromise;

  storeLoadPromise = (async () => {
    if (!USE_SUPABASE) {
      memoryStore = loadLocalStoreOnly();
      storeLoaded = true;
      lastDatabaseError = null;
      lastDatabaseLoadedAt = new Date().toISOString();
      return memoryStore;
    }

    try {
      const row = await supabaseGetStoreRow();

      if (row && row.data) {
        memoryStore = normalizeStore(row.data);
      } else {
        memoryStore = loadLocalStoreOnly();
        const normalized = normalizeStore(memoryStore);
        await supabaseUpsertStore(normalized);
        memoryStore = normalized;
      }

      fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
      fs.writeFileSync(STORE_PATH, JSON.stringify(memoryStore, null, 2), "utf8");

      storeLoaded = true;
      lastDatabaseError = null;
      lastDatabaseLoadedAt = new Date().toISOString();
      return memoryStore;
    } catch (e) {
      lastDatabaseError = supabaseErrorMessage(e);
      console.error("Supabase load error:", lastDatabaseError);
      memoryStore = loadLocalStoreOnly();
      storeLoaded = true;
      lastDatabaseLoadedAt = new Date().toISOString();
      return memoryStore;
    }
  })();

  return storeLoadPromise;
}

async function persistStoreToSupabase(normalized, previousStore, reason) {
  if (!USE_SUPABASE) return;

  const now = new Date().toISOString();

  if (previousStore) {
    try {
      await supabaseInsertBackup(reason, normalizeStore(previousStore));
    } catch (backupError) {
      console.error("Supabase backup insert error:", supabaseErrorMessage(backupError));
    }
  }

  await supabaseUpsertStore(normalized);

  lastDatabaseError = null;
  lastDatabaseSavedAt = now;
}

function saveStore(store, reason = "save") {
  const previousStore = memoryStore ? normalizeStore(memoryStore) : loadLocalStoreOnly();
  const normalized = normalizeStore(store);

  if (Array.isArray(normalized.processedMessageIds) && normalized.processedMessageIds.length > 300) {
    normalized.processedMessageIds = normalized.processedMessageIds.slice(-300);
  }

  memoryStore = normalized;
  storeLoaded = true;

  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    createStoreBackup(reason);
    fs.writeFileSync(STORE_PATH, JSON.stringify(normalized, null, 2), "utf8");
  } catch (e) {
    console.error("local saveStore error", e.message);
  }

  if (USE_SUPABASE) {
    persistQueue = persistQueue
      .then(() => persistStoreToSupabase(normalized, previousStore, reason))
      .catch(err => {
        lastDatabaseError = supabaseErrorMessage(err);
        console.error("Supabase persist error:", lastDatabaseError);
      });
  }
}

app.use(async (req, res, next) => {
  try {
    await ensureStoreLoaded();
    next();
  } catch (e) {
    res.status(500).json({ ok: false, error: "Nu pot încărca baza de date.", detail: e.message || String(e) });
  }
});

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

function publicEmployees(employees) {
  return (employees || []).map(emp => ({
    name: emp.name || "",
    phone: emp.phone || "",
    displayPhone: emp.displayPhone || displayPhone(emp.phone),
    color: emp.color || "#16a34a",
    blocked: Boolean(emp.blocked),
    cooldownMinutes: getCooldownMinutes(emp),
    blockedUntil: emp.blockedUntil || "",
    lastGiftAt: emp.lastGiftAt || ""
  }));
}

function parseCooldownMinutes(value, fallback = DEFAULT_GIFT_COOLDOWN_MINUTES) {
  const n = parseInt(String(value ?? "").replace(/[^0-9]/g, ""), 10);
  if (Number.isFinite(n) && n >= 0) return Math.min(n, 10080);
  const f = parseInt(String(fallback ?? ""), 10);
  return Number.isFinite(f) && f >= 0 ? Math.min(f, 10080) : 60;
}

function getCooldownMinutes(employee) {
  return parseCooldownMinutes(employee?.cooldownMinutes, DEFAULT_GIFT_COOLDOWN_MINUTES);
}

function parseTimeMs(value) {
  const t = Date.parse(String(value || ""));
  return Number.isFinite(t) ? t : 0;
}

function getTemporaryBlock(employee) {
  const untilMs = parseTimeMs(employee?.blockedUntil);
  const nowMs = Date.now();
  if (untilMs > nowMs) {
    return {
      active: true,
      untilIso: new Date(untilMs).toISOString(),
      minutesLeft: Math.max(1, Math.ceil((untilMs - nowMs) / 60000))
    };
  }
  return { active: false, untilIso: "", minutesLeft: 0 };
}

function clearExpiredCooldown(employee) {
  if (!employee) return;
  const untilMs = parseTimeMs(employee.blockedUntil);
  if (untilMs && untilMs <= Date.now()) {
    employee.blockedUntil = "";
  }
}

function applyCooldownToEmployee(employee, sentAtIso) {
  if (!employee) return "";
  const minutes = getCooldownMinutes(employee);
  employee.lastGiftAt = sentAtIso || new Date().toISOString();

  if (minutes <= 0) {
    employee.blockedUntil = "";
    return "";
  }

  const baseMs = parseTimeMs(sentAtIso) || Date.now();
  const untilIso = new Date(baseMs + minutes * 60000).toISOString();
  employee.blockedUntil = untilIso;
  return untilIso;
}

function formatCooldownTimeForRo(untilIso) {
  const until = new Date(untilIso);
  return until.toLocaleTimeString("ro-RO", {
    timeZone: "Europe/Bucharest",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function buildCooldownMessage(employee, block) {
  return (
    "Ai primit deja un gift. Pentru a evita primirea de două ori prea repede, următorul gift poate fi solicitat după ora " +
    formatCooldownTimeForRo(block.untilIso) +
    " (în aproximativ " + block.minutesLeft + " min). Dacă este o urgență, contactează administratorul."
  );
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

function sentCount(store) {
  return (store.cards || []).filter(c => (c.status || "available") === "sent").length;
}

function findCardByCodeOrId(store, value) {
  const key = String(value || "").trim();
  return (store.cards || []).find(c =>
    String(c.code || "") === key ||
    String(c.id || "") === key ||
    String(c.fileBase || "") === key ||
    String(c.last4 || "") === key
  ) || null;
}

function markCardSent(store, card, employee, source) {
  const sentAt = new Date().toISOString();
  card.status = "sent";
  card.sentAt = sentAt;
  card.sentTo = employee?.name || "";
  card.sentPhone = employee?.displayPhone || (employee?.phone ? displayPhone(employee.phone) : "");
  card.sentSource = source || "manual_html";

  const remainingAfter = remainingAvailableCount(store);

  store.sentLog.push({
    id: card.id,
    code: card.code,
    last4: card.last4,
    fileBase: card.fileBase,
    value: card.value,
    sentAt,
    sentTo: card.sentTo,
    sentPhone: card.sentPhone,
    sentSource: card.sentSource,
    remainingAfter
  });

  return { sentAt, remainingAfter, sentTotal: sentCount(store) };
}

function formatGiftValueForText(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/[^0-9]/g, "");
  const n = parseInt(digits || "0", 10);
  if (Number.isFinite(n) && n > 0) {
    return n.toLocaleString("ro-RO") + " lei";
  }
  return raw || "2.000 lei";
}

function buildEmployeeGiftCaption(card) {
  return "Ai primit un gift card în valoare de " + formatGiftValueForText(card && card.value) + ".";
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
    "Valoare: " + formatGiftValueForText(card.value) + "\n" +
    "Gifturi rămase: " + remainingAfter
  );
}

function isGiftCommand(text) {
  const value = String(text || "").trim().toLowerCase();
  return value === "gift" || value === "ghift";
}

function recordInboundMessage(from, text, type, messageId) {
  const store = loadStore();
  store.lastInbound = {
    at: new Date().toISOString(),
    from: normalizePhone(from),
    text: String(text || ""),
    type: type || "",
    messageId: messageId || ""
  };
  saveStore(store, "store_update");
}

async function handleGiftRequest(from, messageId) {
  const store = loadStore();

  if (messageId && store.processedMessageIds.includes(messageId)) {
    store.lastGiftRequest = {
      at: new Date().toISOString(),
      from: normalizePhone(from),
      result: "duplicate"
    };
    saveStore(store, "store_update");
    return { ok: true, duplicate: true };
  }

  const employee = findEmployeeByPhone(store, from);
  if (!employee) {
    await sendTextMessage(from, "Numărul tău nu este înregistrat pentru primirea de gifturi.");
    store.lastGiftRequest = {
      at: new Date().toISOString(),
      from: normalizePhone(from),
      result: "employee_not_found"
    };
    if (messageId) store.processedMessageIds.push(messageId);
    saveStore(store, "store_update");
    return { ok: false, reason: "employee_not_found" };
  }

  if (employee.blocked) {
    await sendTextMessage(from, "Momentan nu ești eligibil pentru primirea unui gift. Te rugăm să contactezi administratorul.");
    store.lastGiftRequest = {
      at: new Date().toISOString(),
      from: normalizePhone(from),
      employee: employee.name,
      result: "employee_blocked"
    };
    if (messageId) store.processedMessageIds.push(messageId);
    saveStore(store, "store_update");
    return { ok: false, reason: "employee_blocked" };
  }

  clearExpiredCooldown(employee);
  const temporaryBlock = getTemporaryBlock(employee);
  if (temporaryBlock.active) {
    await sendTextMessage(from, buildCooldownMessage(employee, temporaryBlock));
    store.lastGiftRequest = {
      at: new Date().toISOString(),
      from: normalizePhone(from),
      employee: employee.name,
      result: "employee_cooldown",
      blockedUntil: temporaryBlock.untilIso,
      minutesLeft: temporaryBlock.minutesLeft
    };
    if (messageId) store.processedMessageIds.push(messageId);
    saveStore(store, "store_update");
    return { ok: false, reason: "employee_cooldown", blockedUntil: temporaryBlock.untilIso };
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
    store.lastGiftRequest = {
      at: new Date().toISOString(),
      from: normalizePhone(from),
      employee: employee.name,
      result: "no_cards"
    };
    if (messageId) store.processedMessageIds.push(messageId);
    saveStore(store, "store_update");
    return { ok: false, reason: "no_cards" };
  }

  const image = dataUrlToBuffer(card.imageDataUrl);
  const mediaId = await uploadMediaBuffer(image.buffer, image.mimetype, (card.fileBase || "card") + ".jpg");

  await sendImageMessage(from, mediaId, buildEmployeeGiftCaption(card));

  const markResult = markCardSent(store, card, employee, "whatsapp_gift_request");
  const sentAt = markResult.sentAt;
  const remainingAfter = markResult.remainingAfter;
  const blockedUntil = applyCooldownToEmployee(employee, sentAt);

  const adminCaption = buildAdminCaption(employee, card, remainingAfter);
  try {
    await sendImageMessage(normalizePhone(ADMIN_COPY_PHONE), mediaId, adminCaption);
  } catch (e) {
    console.error("admin copy failed:", e.response?.data || e.message);
  }

  store.lastGiftRequest = {
    at: sentAt,
    from: normalizePhone(from),
    employee: employee.name,
    card: card.fileBase,
    remainingAfter,
    cooldownMinutes: getCooldownMinutes(employee),
    blockedUntil,
    result: "sent"
  };

  if (messageId) store.processedMessageIds.push(messageId);
  saveStore(store, "store_update");

  return { ok: true, employee: employee.name, card: card.fileBase, remainingAfter };
}

app.get("/", (req, res) => {
  const store = loadStore();
  res.json({
    ok: true,
    service: "Bringo WhatsApp Backend",
    version: "v17-supabase-axios-diagnostics",
    configured: requireConfig().length === 0,
    mode: TEMPLATE_NAME ? "template_with_image" : "direct_image_message",
    cardsAvailable: remainingAvailableCount(store),
    cardsSent: sentCount(store),
    cardsTotal: store.cards.length,
    employees: store.employees.length,
    employeesInCooldown: (store.employees || []).filter(emp => getTemporaryBlock(emp).active).length,
    storage: USE_SUPABASE ? "supabase" : "local_file",
    databaseConfigured: USE_SUPABASE,
    databaseLoadedAt: lastDatabaseLoadedAt,
    databaseSavedAt: lastDatabaseSavedAt,
    databaseError: lastDatabaseError,
    backups: listBackupFiles().length,
    lastInbound: store.lastInbound || null,
    lastGiftRequest: store.lastGiftRequest || null
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
    wabaId: WABA_ID,
    employeeGiftCaption: EMPLOYEE_GIFT_CAPTION,
    defaultGiftCooldownMinutes: DEFAULT_GIFT_COOLDOWN_MINUTES,
    storage: USE_SUPABASE ? "supabase" : "local_file",
    databaseConfigured: USE_SUPABASE,
    databaseLoadedAt: lastDatabaseLoadedAt,
    databaseSavedAt: lastDatabaseSavedAt,
    databaseError: lastDatabaseError,
    cardsAvailable: remainingAvailableCount(store),
    cardsSent: sentCount(store),
    cardsTotal: store.cards.length,
    employees: store.employees.length,
    lastInbound: store.lastInbound || null,
    lastGiftRequest: store.lastGiftRequest || null
  });
});

app.get("/supabase-test", checkApiKey, async (req, res) => {
  const started = Date.now();
  try {
    if (!USE_SUPABASE) {
      return res.json({
        ok: false,
        supabaseConfigured: false,
        message: "SUPABASE_URL sau SUPABASE_SERVICE_ROLE_KEY lipsesc."
      });
    }

    const row = await supabaseGetStoreRow();

    res.json({
      ok: true,
      supabaseConfigured: true,
      url: supabaseBaseUrl(),
      storeKey: SUPABASE_STORE_ID,
      connected: true,
      storeExists: Boolean(row),
      storeUpdatedAt: row?.updated_at || null,
      ms: Date.now() - started
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      supabaseConfigured: USE_SUPABASE,
      url: supabaseBaseUrl(),
      storeKey: SUPABASE_STORE_ID,
      error: supabaseErrorMessage(err),
      code: err.code || null,
      status: err.response?.status || null,
      ms: Date.now() - started
    });
  }
});

app.get("/db-status", checkApiKey, async (req, res) => {
  try {
    await ensureStoreLoaded();
    let backupCount = listBackupFiles().length;
    let storeRow = null;

    if (USE_SUPABASE) {
      const backupRows = await supabaseListBackups(200);
      backupCount = backupRows.length;

      const row = await supabaseGetStoreRow();
      if (row) storeRow = { store_key: row.store_key, updated_at: row.updated_at };
    }

    const store = loadStore();
    res.json({
      ok: true,
      storage: USE_SUPABASE ? "supabase" : "local_file",
      supabaseConfigured: USE_SUPABASE,
      storeKey: SUPABASE_STORE_ID,
      storeRow,
      databaseLoadedAt: lastDatabaseLoadedAt,
      databaseSavedAt: lastDatabaseSavedAt,
      databaseError: lastDatabaseError,
      cardsTotal: store.cards.length,
      employees: store.employees.length,
      backups: backupCount
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || "Eroare db-status" });
  }
});

app.post("/reload-db", checkApiKey, async (req, res) => {
  try {
    storeLoaded = false;
    storeLoadPromise = null;
    memoryStore = null;
    await ensureStoreLoaded();
    const store = loadStore();
    res.json({
      ok: true,
      reloaded: true,
      storage: USE_SUPABASE ? "supabase" : "local_file",
      cardsAvailable: remainingAvailableCount(store),
      cardsSent: sentCount(store),
      cardsTotal: store.cards.length,
      employees: store.employees.length
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || "Eroare reload-db" });
  }
});

app.get("/backups", checkApiKey, async (req, res) => {
  try {
    if (USE_SUPABASE) {
      const rows = await supabaseListBackups(req.query.limit || "50");

      const backups = (rows || []).map(row => {
        const backupStore = normalizeStore(row.data || {});
        return {
          id: row.id,
          reason: row.reason || "",
          createdAt: row.created_at,
          cardsTotal: backupStore.cards.length,
          employees: backupStore.employees.length,
          cardsSent: sentCount(backupStore),
          cardsAvailable: remainingAvailableCount(backupStore)
        };
      });

      return res.json({ ok: true, storage: "supabase", backups });
    }

    const files = listBackupFiles().map(file => {
      let summary = { cardsTotal: null, employees: null, cardsSent: null, cardsAvailable: null };
      try {
        const backupStore = normalizeStore(JSON.parse(fs.readFileSync(file.fullPath, "utf8")));
        summary = {
          cardsTotal: backupStore.cards.length,
          employees: backupStore.employees.length,
          cardsSent: sentCount(backupStore),
          cardsAvailable: remainingAvailableCount(backupStore)
        };
      } catch (e) {}
      return {
        file: file.name,
        createdAt: new Date(file.mtimeMs).toISOString(),
        sizeBytes: file.sizeBytes,
        ...summary
      };
    });
    res.json({ ok: true, storage: "local_file", backups: files });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || "Eroare listare backup" });
  }
});

app.post("/restore-backup", checkApiKey, async (req, res) => {
  try {
    let backupStore;
    let restored;

    if (USE_SUPABASE) {
      const id = req.body.id || req.query.id;
      if (!id) return res.status(400).json({ ok: false, error: "Specifică id-ul backup-ului din /backups." });

      const row = await supabaseGetBackupById(id);
      if (!row) return res.status(404).json({ ok: false, error: "Backup-ul nu există." });

      backupStore = normalizeStore(row.data || {});
      restored = String(row.id);
    } else {
      const file = path.basename(String(req.body.file || req.query.file || ""));
      if (!file || !file.endsWith(".json")) {
        return res.status(400).json({ ok: false, error: "Specifică fișierul backup din /backups." });
      }

      const backupPath = path.join(BACKUP_DIR, file);
      if (!fs.existsSync(backupPath)) {
        return res.status(404).json({ ok: false, error: "Backup-ul nu există." });
      }

      backupStore = normalizeStore(JSON.parse(fs.readFileSync(backupPath, "utf8")));
      restored = file;
    }

    saveStore(backupStore, "before_restore");

    res.json({
      ok: true,
      restored,
      storage: USE_SUPABASE ? "supabase" : "local_file",
      cardsAvailable: remainingAvailableCount(backupStore),
      cardsSent: sentCount(backupStore),
      cardsTotal: backupStore.cards.length,
      employees: backupStore.employees.length
    });
  } catch (err) {
    console.error("restore-backup error", err);
    res.status(500).json({ ok: false, error: err.message || "Eroare restore-backup" });
  }
});

app.get("/export-store", checkApiKey, (req, res) => {
  try {
    const store = loadStore();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=bringo_store_export.json");
    res.send(JSON.stringify(store, null, 2));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || "Eroare export-store" });
  }
});

app.get("/state", checkApiKey, (req, res) => {
  const store = loadStore();
  res.json({
    ok: true,
    cardsAvailable: remainingAvailableCount(store),
    cardsSent: sentCount(store),
    cardsTotal: store.cards.length,
    employees: store.employees.length,
    cardsUpdatedAt: store.cardsUpdatedAt || "",
    employeesUpdatedAt: store.employeesUpdatedAt || "",
    cards: publicCards(store.cards),
    employeeList: publicEmployees(store.employees),
    sentLog: store.sentLog || [],
    storage: USE_SUPABASE ? "supabase" : "local_file",
    databaseConfigured: USE_SUPABASE,
    databaseLoadedAt: lastDatabaseLoadedAt,
    databaseSavedAt: lastDatabaseSavedAt,
    databaseError: lastDatabaseError,
    backups: listBackupFiles().length
  });
});

app.post("/sync-state", checkApiKey, async (req, res) => {
  try {
    const replaceMode = Boolean(req.body.replaceMode);
    const previousStore = loadStore();
    const store = replaceMode
      ? { ...defaultStore(), employees: previousStore.employees || [], cards: previousStore.cards || [], sentLog: previousStore.sentLog || [] }
      : previousStore;

    const now = new Date().toISOString();

    const incomingEmployeesProvided = Array.isArray(req.body.employees);
    const incomingCardsProvided = Array.isArray(req.body.cards);
    const allowEmptyEmployees = Boolean(req.body.allowEmptyEmployees);
    const allowEmptyCards = Boolean(req.body.allowEmptyCards);

    if (incomingEmployeesProvided) {
      const incomingEmployees = req.body.employees || [];
      const previousEmployeesByPhone = new Map(
        (previousStore.employees || []).map(emp => [normalizePhone(emp.phone), emp])
      );

      if (incomingEmployees.length || allowEmptyEmployees) {
        store.employees = incomingEmployees
          .map(emp => {
            const phone = normalizePhone(emp.phone);
            const previous = previousEmployeesByPhone.get(phone) || {};
            const hasBlockedUntil = Object.prototype.hasOwnProperty.call(emp, "blockedUntil");
            const hasLastGiftAt = Object.prototype.hasOwnProperty.call(emp, "lastGiftAt");

            return {
              name: String(emp.name || "").trim().toUpperCase(),
              phone,
              displayPhone: emp.displayPhone || displayPhone(phone),
              color: emp.color || "#16a34a",
              blocked: Boolean(emp.blocked),
              cooldownMinutes: parseCooldownMinutes(emp.cooldownMinutes, previous.cooldownMinutes ?? DEFAULT_GIFT_COOLDOWN_MINUTES),
              blockedUntil: hasBlockedUntil ? String(emp.blockedUntil || "") : String(previous.blockedUntil || ""),
              lastGiftAt: hasLastGiftAt ? String(emp.lastGiftAt || "") : String(previous.lastGiftAt || "")
            };
          })
          .filter(emp => emp.name && /^40\d{9}$/.test(emp.phone));

        store.employees.forEach(clearExpiredCooldown);
        store.employeesUpdatedAt = now;
      }
    }

    if (incomingCardsProvided) {
      const incomingCards = req.body.cards || [];

      if (incomingCards.length || allowEmptyCards) {
        const existingByCode = new Map((previousStore.cards || []).filter(c => c.code).map(c => [String(c.code), c]));
        const nextCards = [];

        for (const raw of incomingCards) {
          const code = String(raw.code || "").trim();
          if (!code) continue;

          const existing = existingByCode.get(code);
          const incomingStatus = raw.status === "sent" ? "sent" : "available";

          const base = {
            id: String(raw.id || existing?.id || code),
            code,
            last4: String(raw.last4 || existing?.last4 || code.slice(-4)),
            value: String(raw.value || existing?.value || ""),
            fileBase: String(raw.fileBase || existing?.fileBase || code.slice(-4)),
            imageDataUrl: raw.imageDataUrl || existing?.imageDataUrl || "",
            syncedAt: now
          };

          if (existing && existing.status === "sent" && incomingStatus !== "available") {
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
              sentAt: incomingStatus === "sent" ? (raw.sentAt || existing?.sentAt || "") : "",
              sentTo: incomingStatus === "sent" ? (raw.sentTo || existing?.sentTo || "") : "",
              sentPhone: incomingStatus === "sent" ? (raw.sentPhone || existing?.sentPhone || "") : "",
              sentSource: incomingStatus === "sent" ? (raw.sentSource || existing?.sentSource || "manual_html") : ""
            });
          }
        }

        const nextCodes = new Set(nextCards.map(c => String(c.code)));
        for (const existing of previousStore.cards || []) {
          if (existing.status === "sent" && existing.code && !nextCodes.has(String(existing.code))) {
            nextCards.push(existing);
          }
        }

        store.cards = nextCards;
        store.cardsUpdatedAt = now;
      }
    }

    if (typeof req.body.adminPhone !== "undefined") {
      store.adminPhone = normalizePhone(req.body.adminPhone || ADMIN_COPY_PHONE);
    }

    saveStore(store, "store_update");

    res.json({
      ok: true,
      cardsAvailable: remainingAvailableCount(store),
      cardsSent: sentCount(store),
      cardsTotal: store.cards.length,
      employees: store.employees.length,
      cardsUpdatedAt: store.cardsUpdatedAt || "",
      employeesUpdatedAt: store.employeesUpdatedAt || ""
    });
  } catch (err) {
    console.error("sync-state error", err);
    res.status(500).json({ ok: false, error: err.message || "Eroare sync-state" });
  }
});

async function subscribeWabaToApp() {
  const missing = requireConfig();
  if (missing.length) {
    throw new Error("Lipsesc variabile Render: " + missing.join(", "));
  }

  if (!WABA_ID) {
    throw new Error("Lipsește WABA_ID.");
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WABA_ID}/subscribed_apps`;

  const response = await axios.post(url, {}, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    }
  });

  return response.data;
}

app.get("/subscribe-waba", checkApiKey, async (req, res) => {
  try {
    const result = await subscribeWabaToApp();
    res.json({
      ok: true,
      message: "WABA a fost subscrisă la aplicația curentă pentru webhook-uri.",
      wabaId: WABA_ID,
      graphVersion: GRAPH_VERSION,
      result
    });
  } catch (err) {
    const meta = err.response?.data;
    console.error("subscribe-waba error:", meta || err.message || err);
    res.status(500).json({
      ok: false,
      error: meta?.error?.message || err.message || "Eroare subscribe-waba",
      meta,
      wabaId: WABA_ID
    });
  }
});

app.post("/subscribe-waba", checkApiKey, async (req, res) => {
  try {
    const result = await subscribeWabaToApp();
    res.json({
      ok: true,
      message: "WABA a fost subscrisă la aplicația curentă pentru webhook-uri.",
      wabaId: WABA_ID,
      graphVersion: GRAPH_VERSION,
      result
    });
  } catch (err) {
    const meta = err.response?.data;
    console.error("subscribe-waba error:", meta || err.message || err);
    res.status(500).json({
      ok: false,
      error: meta?.error?.message || err.message || "Eroare subscribe-waba",
      meta,
      wabaId: WABA_ID
    });
  }
});

function normalizeEmployeeForStore(emp, previous = {}, index = 0) {
  const phone = normalizePhone(emp.phone);
  return {
    name: String(emp.name || previous.name || "").trim().toUpperCase(),
    phone,
    displayPhone: emp.displayPhone || previous.displayPhone || displayPhone(phone),
    color: emp.color || previous.color || "#16a34a",
    blocked: Boolean(emp.blocked ?? previous.blocked),
    cooldownMinutes: parseCooldownMinutes(emp.cooldownMinutes, previous.cooldownMinutes ?? DEFAULT_GIFT_COOLDOWN_MINUTES),
    blockedUntil: Object.prototype.hasOwnProperty.call(emp, "blockedUntil") ? String(emp.blockedUntil || "") : String(previous.blockedUntil || ""),
    lastGiftAt: Object.prototype.hasOwnProperty.call(emp, "lastGiftAt") ? String(emp.lastGiftAt || "") : String(previous.lastGiftAt || "")
  };
}

app.post("/upsert-employees", checkApiKey, (req, res) => {
  try {
    const store = loadStore();
    const now = new Date().toISOString();
    const incomingEmployees = Array.isArray(req.body.employees) ? req.body.employees : [];

    if (!incomingEmployees.length) {
      return res.status(400).json({ ok: false, error: "Nu ai trimis niciun livrator." });
    }

    const byPhone = new Map((store.employees || []).map(emp => [normalizePhone(emp.phone), emp]));
    let added = 0;
    let updated = 0;
    let ignored = 0;

    for (const raw of incomingEmployees) {
      const phone = normalizePhone(raw.phone);
      if (!/^40\d{9}$/.test(phone)) {
        ignored++;
        continue;
      }

      const previous = byPhone.get(phone) || {};
      const employee = normalizeEmployeeForStore({ ...raw, phone }, previous);

      if (!employee.name) {
        ignored++;
        continue;
      }

      clearExpiredCooldown(employee);

      if (byPhone.has(phone)) {
        const index = store.employees.findIndex(emp => normalizePhone(emp.phone) === phone);
        if (index >= 0) store.employees[index] = employee;
        updated++;
      } else {
        store.employees.push(employee);
        added++;
      }

      byPhone.set(phone, employee);
    }

    store.employeesUpdatedAt = now;
    saveStore(store, "store_update");

    res.json({
      ok: true,
      message: "Livratorii au fost salvați în backend.",
      added,
      updated,
      ignored,
      employees: store.employees.length,
      employeesUpdatedAt: store.employeesUpdatedAt,
      employeeList: publicEmployees(store.employees)
    });
  } catch (err) {
    console.error("upsert-employees error:", err);
    res.status(500).json({ ok: false, error: err.message || "Eroare upsert-employees" });
  }
});

app.post("/delete-employee", checkApiKey, (req, res) => {
  try {
    const store = loadStore();
    const phone = normalizePhone(req.body.phone);
    const before = store.employees.length;

    store.employees = (store.employees || []).filter(emp => normalizePhone(emp.phone) !== phone);
    store.employeesUpdatedAt = new Date().toISOString();

    saveStore(store, "store_update");

    res.json({
      ok: true,
      deleted: before !== store.employees.length,
      employees: store.employees.length,
      employeesUpdatedAt: store.employeesUpdatedAt,
      employeeList: publicEmployees(store.employees)
    });
  } catch (err) {
    console.error("delete-employee error:", err);
    res.status(500).json({ ok: false, error: err.message || "Eroare delete-employee" });
  }
});

app.post("/clear-cards", checkApiKey, (req, res) => {
  try {
    const store = loadStore();
    store.cards = [];
    store.sentLog = [];
    store.lastGiftRequest = null;
    store.cardsUpdatedAt = new Date().toISOString();
    saveStore(store, "store_update");

    res.json({
      ok: true,
      message: "Cardurile au fost șterse, livratorii au fost păstrați.",
      cardsAvailable: 0,
      cardsSent: 0,
      cardsTotal: 0,
      employees: store.employees.length,
      cardsUpdatedAt: store.cardsUpdatedAt || ''
    });
  } catch (err) {
    console.error("clear-cards error:", err);
    res.status(500).json({ ok: false, error: err.message || "Eroare clear-cards" });
  }
});

app.post("/upsert-cards", checkApiKey, (req, res) => {
  try {
    const store = loadStore();
    const now = new Date().toISOString();
    const incomingCards = Array.isArray(req.body.cards) ? req.body.cards : [];

    if (typeof req.body.adminPhone !== "undefined") {
      store.adminPhone = normalizePhone(req.body.adminPhone || ADMIN_COPY_PHONE);
    }

    const existingByCode = new Map((store.cards || []).filter(c => c.code).map(c => [String(c.code), c]));
    let added = 0;
    let updated = 0;
    let ignored = 0;

    for (const raw of incomingCards) {
      const code = String(raw.code || "").trim();
      if (!code) {
        ignored++;
        continue;
      }

      const existing = existingByCode.get(code);
      const incomingStatus = raw.status === "sent" ? "sent" : "available";

      if (existing) {
        existing.id = String(raw.id || existing.id || code);
        existing.last4 = String(raw.last4 || existing.last4 || code.slice(-4));
        existing.value = String(raw.value || existing.value || "");
        existing.fileBase = String(raw.fileBase || existing.fileBase || code.slice(-4));
        existing.imageDataUrl = raw.imageDataUrl || existing.imageDataUrl || "";
        existing.syncedAt = now;

        // Nu transformăm un card trimis în disponibil prin upsert simplu.
        // Revino disponibil are sincronizarea lui separată.
        if ((existing.status || "available") !== "sent") {
          existing.status = incomingStatus;
          existing.sentAt = incomingStatus === "sent" ? (raw.sentAt || existing.sentAt || now) : "";
          existing.sentTo = incomingStatus === "sent" ? (raw.sentTo || existing.sentTo || "") : "";
          existing.sentPhone = incomingStatus === "sent" ? (raw.sentPhone || existing.sentPhone || "") : "";
          existing.sentSource = incomingStatus === "sent" ? (raw.sentSource || existing.sentSource || "manual_html") : "";
        }

        updated++;
      } else {
        const card = {
          id: String(raw.id || code),
          code,
          last4: String(raw.last4 || code.slice(-4)),
          value: String(raw.value || ""),
          fileBase: String(raw.fileBase || code.slice(-4)),
          imageDataUrl: raw.imageDataUrl || "",
          status: incomingStatus,
          sentAt: incomingStatus === "sent" ? (raw.sentAt || now) : "",
          sentTo: incomingStatus === "sent" ? (raw.sentTo || "") : "",
          sentPhone: incomingStatus === "sent" ? (raw.sentPhone || "") : "",
          sentSource: incomingStatus === "sent" ? (raw.sentSource || "manual_html") : "",
          syncedAt: now
        };
        store.cards.push(card);
        existingByCode.set(code, card);
        added++;
      }
    }

    store.cardsUpdatedAt = now;
    saveStore(store, "store_update");

    res.json({
      ok: true,
      message: "Cardurile au fost adăugate/actualizate fără ștergerea livratorilor.",
      added,
      updated,
      ignored,
      cardsAvailable: remainingAvailableCount(store),
      cardsSent: sentCount(store),
      cardsTotal: store.cards.length,
      employees: store.employees.length
    });
  } catch (err) {
    console.error("upsert-cards error:", err);
    res.status(500).json({ ok: false, error: err.message || "Eroare upsert-cards" });
  }
});

app.post("/reset-state", checkApiKey, (req, res) => {
  const previous = loadStore();
  const store = defaultStore();
  store.employees = previous.employees || [];
  store.adminPhone = previous.adminPhone || normalizePhone(ADMIN_COPY_PHONE);
  saveStore(store, "store_update");
  res.json({
    ok: true,
    reset: true,
    message: "Backend resetat pentru carduri. Livratorii au fost păstrați.",
    cardsAvailable: 0,
    cardsSent: 0,
    cardsTotal: 0,
    employees: store.employees.length
  });
});

app.post("/update-card-value", checkApiKey, (req, res) => {
  try {
    const store = loadStore();
    const lookup = req.body.code || req.body.id || req.body.fileBase || req.body.last4;
    const card = findCardByCodeOrId(store, lookup);

    if (!card) {
      return res.status(404).json({
        ok: false,
        error: "Cardul nu există în backend. Apasă Sincronizează Gift și încearcă din nou."
      });
    }

    const newValue = formatGiftValueForText(req.body.value);
    card.value = newValue;
    card.updatedAt = new Date().toISOString();

    if (Array.isArray(store.sentLog)) {
      store.sentLog = store.sentLog.map(item => {
        const match =
          String(item.code || "") === String(card.code || "") ||
          String(item.id || "") === String(card.id || "") ||
          String(item.fileBase || "") === String(card.fileBase || "") ||
          String(item.last4 || "") === String(card.last4 || "");
        return match ? { ...item, value: newValue } : item;
      });
    }

    saveStore(store, "store_update");

    res.json({
      ok: true,
      message: "Valoarea cardului a fost actualizată.",
      value: newValue,
      cardsAvailable: remainingAvailableCount(store),
      cardsSent: sentCount(store),
      cardsTotal: store.cards.length,
      card: publicCards([card])[0]
    });
  } catch (err) {
    console.error("update-card-value error:", err);
    res.status(500).json({ ok: false, error: err.message || "Eroare update-card-value" });
  }
});

app.post("/mark-card-sent", checkApiKey, (req, res) => {
  try {
    const store = loadStore();
    const card = findCardByCodeOrId(store, req.body.code || req.body.id || req.body.fileBase || req.body.last4);
    if (!card) return res.status(404).json({ ok: false, error: "Cardul nu există în backend. Apasă Sincronizează Gift." });

    const employee = {
      name: String(req.body.employeeName || "").trim().toUpperCase(),
      phone: normalizePhone(req.body.employeePhone || ""),
      displayPhone: req.body.employeeDisplayPhone || displayPhone(req.body.employeePhone || "")
    };

    if ((card.status || "available") === "sent") {
      saveStore(store, "store_update");
      return res.json({
        ok: true,
        alreadySent: true,
        remainingAfter: remainingAvailableCount(store),
        sentTotal: sentCount(store),
        cardsTotal: store.cards.length,
        card: publicCards([card])[0]
      });
    }

    const result = markCardSent(store, card, employee, req.body.source || "manual_html");

    const storeEmployee = findEmployeeByPhone(store, employee.phone);
    let employeeBlockedUntil = "";
    let employeeCooldownMinutes = DEFAULT_GIFT_COOLDOWN_MINUTES;
    if (storeEmployee) {
      employeeBlockedUntil = applyCooldownToEmployee(storeEmployee, result.sentAt);
      employeeCooldownMinutes = getCooldownMinutes(storeEmployee);
    }

    saveStore(store, "store_update");

    res.json({
      ok: true,
      alreadySent: false,
      remainingAfter: result.remainingAfter,
      sentTotal: result.sentTotal,
      cardsTotal: store.cards.length,
      employeeBlockedUntil,
      employeeCooldownMinutes,
      card: publicCards([card])[0]
    });
  } catch (err) {
    console.error("mark-card-sent error:", err);
    res.status(500).json({ ok: false, error: err.message || "Eroare mark-card-sent" });
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

          const originalText = String(msg.text?.body || "").trim();
          const text = originalText.toLowerCase();
          const from = normalizePhone(msg.from);
          const messageId = msg.id || "";

          recordInboundMessage(from, originalText, msg.type, messageId);

          if (isGiftCommand(text)) {
            const result = await handleGiftRequest(from, messageId);
            console.log("Gift request result:", result);
          } else {
            console.log("Inbound text ignored:", { from, text: originalText });
          }
        }
      }
    }
  } catch (err) {
    console.error("webhook processing error:", err.response?.data || err.message || err);
  }
});

app.listen(PORT, () => {
  console.log(`Bringo WhatsApp Backend v17 Supabase database running on port ${PORT}`);
});
