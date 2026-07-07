const express = require("express");
const cors = require("cors");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");

const app = express();

const PORT = process.env.PORT || 10000;
const GRAPH_VERSION = process.env.GRAPH_API_VERSION || "v23.0";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const TEMPLATE_NAME = process.env.TEMPLATE_NAME || "";
const TEMPLATE_LANGUAGE = process.env.TEMPLATE_LANGUAGE || "ro";
const BACKEND_API_KEY = process.env.BACKEND_API_KEY || "";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

app.use(cors({ origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN }));
app.use(express.json({ limit: "2mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
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

function checkApiKey(req, res, next) {
  if (!BACKEND_API_KEY) return next();
  const sent = req.headers["x-api-key"] || req.body?.apiKey || req.query?.apiKey;
  if (sent !== BACKEND_API_KEY) {
    return res.status(401).json({ ok: false, error: "API key invalid sau lipsa." });
  }
  next();
}

async function uploadMediaToWhatsApp(file) {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", file.mimetype || "image/jpeg");
  form.append("file", file.buffer, {
    filename: file.originalname || "card.jpg",
    contentType: file.mimetype || "image/jpeg"
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

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Bringo WhatsApp Backend",
    configured: requireConfig().length === 0,
    mode: TEMPLATE_NAME ? "template_with_image" : "direct_image_message"
  });
});

app.get("/health", (req, res) => {
  const missing = requireConfig();
  res.json({
    ok: missing.length === 0,
    missing,
    phoneNumberIdPresent: Boolean(PHONE_NUMBER_ID),
    tokenPresent: Boolean(WHATSAPP_TOKEN),
    templateName: TEMPLATE_NAME || null
  });
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

app.listen(PORT, () => {
  console.log(`Bringo WhatsApp Backend running on port ${PORT}`);
});
