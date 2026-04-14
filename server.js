const express = require("express");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const crypto = require("crypto");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT_DIR = __dirname;

/*
  LOCAL:
    ./data/lead-heatmap.db

  RENDER COM DISCO PERSISTENTE:
    defina no Render:
    DB_PATH=/var/data/lead-heatmap.db
*/
const DB_PATH = process.env.DB_PATH || path.join(ROOT_DIR, "data", "lead-heatmap.db");

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(ROOT_DIR));

/* =========================================================
   HELPERS
========================================================= */
function nowIso() {
  return new Date().toISOString();
}

function safeString(value, max = 300) {
  if (value === null || value === undefined) return "";
  return String(value).trim().slice(0, max);
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function generateId() {
  return crypto.randomBytes(12).toString("hex");
}

function normalizeEvent(body, req) {
  const ip =
    req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "";

  const userAgent = req.headers["user-agent"] || "";

  const session_id = safeString(body.session_id || generateId(), 120);
  const lead_id = safeString(body.lead_id || "", 120);
  const event_type = safeString(body.event_type || "", 80);
  const page = safeString(body.page || "", 120);
  const section_id = safeString(body.section_id || "", 120);
  const section_label = safeString(body.section_label || "", 160);

  return {
    id: generateId(),
    created_at: nowIso(),
    session_id,
    lead_id,
    event_type,
    page,
    section_id,
    section_label,
    scroll_percent: Math.max(0, Math.min(100, Math.round(safeNumber(body.scroll_percent, 0)))),
    time_on_page_ms: Math.max(0, safeNumber(body.time_on_page_ms, 0)),
    time_in_section_ms: Math.max(0, safeNumber(body.time_in_section_ms, 0)),
    viewport_w: Math.max(0, safeNumber(body.viewport_w, 0)),
    viewport_h: Math.max(0, safeNumber(body.viewport_h, 0)),
    clicked: parseBoolean(body.clicked) ? 1 : 0,
    cta_id: safeString(body.cta_id || "", 120),
    cta_label: safeString(body.cta_label || "", 160),
    referrer: safeString(body.referrer || "", 500),
    url: safeString(body.url || "", 500),

    utm_source: safeString(body.utm_source || "", 120),
    utm_medium: safeString(body.utm_medium || "", 120),
    utm_campaign: safeString(body.utm_campaign || "", 180),
    utm_content: safeString(body.utm_content || "", 180),
    utm_term: safeString(body.utm_term || "", 180),

    custom_1: safeString(body.custom_1 || "", 180),
    custom_2: safeString(body.custom_2 || "", 180),

    ip: safeString(ip, 120),
    user_agent: safeString(userAgent, 500),
  };
}

/* =========================================================
   SQLITE
========================================================= */
let db;

function openDb() {
  return new Promise(async (resolve, reject) => {
    try {
      const dbDir = path.dirname(DB_PATH);
      await fsp.mkdir(dbDir, { recursive: true });

      db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) return reject(err);
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({
        lastID: this.lastID,
        changes: this.changes,
      });
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS lead_events (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      session_id TEXT,
      lead_id TEXT,
      event_type TEXT,
      page TEXT,
      section_id TEXT,
      section_label TEXT,
      scroll_percent INTEGER DEFAULT 0,
      time_on_page_ms INTEGER DEFAULT 0,
      time_in_section_ms INTEGER DEFAULT 0,
      viewport_w INTEGER DEFAULT 0,
      viewport_h INTEGER DEFAULT 0,
      clicked INTEGER DEFAULT 0,
      cta_id TEXT,
      cta_label TEXT,
      referrer TEXT,
      url TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      utm_content TEXT,
      utm_term TEXT,
      custom_1 TEXT,
      custom_2 TEXT,
      ip TEXT,
      user_agent TEXT
    )
  `);

  await run(`CREATE INDEX IF NOT EXISTS idx_lead_events_created_at ON lead_events(created_at)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_lead_events_session_id ON lead_events(session_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_lead_events_page ON lead_events(page)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_lead_events_event_type ON lead_events(event_type)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_lead_events_section_id ON lead_events(section_id)`);
}

async function insertEvent(eventData) {
  await run(
    `
    INSERT INTO lead_events (
      id, created_at, session_id, lead_id, event_type, page, section_id, section_label,
      scroll_percent, time_on_page_ms, time_in_section_ms, viewport_w, viewport_h,
      clicked, cta_id, cta_label, referrer, url,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      custom_1, custom_2, ip, user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      eventData.id,
      eventData.created_at,
      eventData.session_id,
      eventData.lead_id,
      eventData.event_type,
      eventData.page,
      eventData.section_id,
      eventData.section_label,
      eventData.scroll_percent,
      eventData.time_on_page_ms,
      eventData.time_in_section_ms,
      eventData.viewport_w,
      eventData.viewport_h,
      eventData.clicked,
      eventData.cta_id,
      eventData.cta_label,
      eventData.referrer,
      eventData.url,
      eventData.utm_source,
      eventData.utm_medium,
      eventData.utm_campaign,
      eventData.utm_content,
      eventData.utm_term,
      eventData.custom_1,
      eventData.custom_2,
      eventData.ip,
      eventData.user_agent,
    ]
  );
}

async function readEvents({ days = 7, page = "" } = {}) {
  let sql = `SELECT * FROM lead_events`;
  const params = [];
  const conditions = [];

  if (days && Number(days) > 0) {
    const minDate = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString();
    conditions.push(`created_at >= ?`);
    params.push(minDate);
  }

  if (page) {
    conditions.push(`page = ?`);
    params.push(page);
  }

  if (conditions.length) {
    sql += ` WHERE ` + conditions.join(" AND ");
  }

  sql += ` ORDER BY created_at DESC`;

  return all(sql, params);
}

/* =========================================================
   SUMÁRIOS
========================================================= */
function summarizeSessions(events) {
  const sessionsMap = new Map();

  for (const event of events) {
    const sessionId = event.session_id || "no-session";
    const page = event.page || "no-page";

    // CORREÇÃO DO BUG:
    // agrupa por session + page, e não só session
    const key = `${sessionId}__${page}`;

    if (!sessionsMap.has(key)) {
      sessionsMap.set(key, {
        session_key: key,
        session_id: sessionId,
        lead_id: event.lead_id || "",
        started_at: event.created_at,
        last_event_at: event.created_at,
        page,
        max_scroll_percent: 0,
        viewed_sections: new Set(),
        reached_price: false,
        clicked_cta: false,
        cta_clicks: 0,
        total_events: 0,
        utm_source: event.utm_source || "",
        utm_medium: event.utm_medium || "",
        utm_campaign: event.utm_campaign || "",
        utm_content: event.utm_content || "",
        utm_term: event.utm_term || "",
      });
    }

    const session = sessionsMap.get(key);

    session.total_events += 1;
    session.last_event_at = event.created_at > session.last_event_at ? event.created_at : session.last_event_at;
    session.started_at = event.created_at < session.started_at ? event.created_at : session.started_at;
    session.max_scroll_percent = Math.max(session.max_scroll_percent, safeNumber(event.scroll_percent, 0));

    if (event.section_id) {
      session.viewed_sections.add(event.section_id);
    }

    if (
      event.section_id === "price_section" ||
      event.section_id === "offer_section" ||
      event.event_type === "price_view"
    ) {
      session.reached_price = true;
    }

    if (event.event_type === "cta_click" || safeNumber(event.clicked, 0) === 1) {
      session.clicked_cta = true;
      session.cta_clicks += 1;
    }
  }

  return Array.from(sessionsMap.values()).map((session) => ({
    ...session,
    viewed_sections: Array.from(session.viewed_sections),
  }));
}

function summarizeSections(events) {
  const sections = {};

  for (const event of events) {
    if (!event.section_id) continue;

    const key = `${event.page || "no-page"}__${event.section_id}`;

    if (!sections[key]) {
      sections[key] = {
        page: event.page || "",
        section_id: event.section_id,
        section_label: event.section_label || event.section_id,
        unique_sessions: new Set(),
        views: 0,
        total_time_in_section_ms: 0,
        avg_time_in_section_ms: 0,
      };
    }

    const row = sections[key];
    row.views += 1;
    row.total_time_in_section_ms += safeNumber(event.time_in_section_ms, 0);

    if (event.session_id) {
      row.unique_sessions.add(`${event.session_id}__${event.page || "no-page"}`);
    }
  }

  return Object.values(sections)
    .map((row) => ({
      page: row.page,
      section_id: row.section_id,
      section_label: row.section_label,
      views: row.views,
      unique_sessions: row.unique_sessions.size,
      total_time_in_section_ms: row.total_time_in_section_ms,
      avg_time_in_section_ms:
        row.views > 0 ? Math.round(row.total_time_in_section_ms / row.views) : 0,
    }))
    .sort((a, b) => b.unique_sessions - a.unique_sessions);
}

function summarizeEvents(events) {
  const sessions = summarizeSessions(events);
  const sections = summarizeSections(events);

  const totalSessions = sessions.length;
  const reachedPrice = sessions.filter((s) => s.reached_price).length;
  const clickedCta = sessions.filter((s) => s.clicked_cta).length;
  const avgScroll =
    totalSessions > 0
      ? Math.round(
          sessions.reduce((sum, s) => sum + safeNumber(s.max_scroll_percent, 0), 0) / totalSessions
        )
      : 0;

  const eventCounts = events.reduce((acc, event) => {
    const key = event.event_type || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    totals: {
      total_events: events.length,
      total_sessions: totalSessions,
      reached_price_sessions: reachedPrice,
      clicked_cta_sessions: clickedCta,
      average_max_scroll_percent: avgScroll,
      price_view_rate:
        totalSessions > 0 ? Number(((reachedPrice / totalSessions) * 100).toFixed(2)) : 0,
      cta_click_rate:
        totalSessions > 0 ? Number(((clickedCta / totalSessions) * 100).toFixed(2)) : 0,
      price_to_click_rate:
        reachedPrice > 0 ? Number(((clickedCta / reachedPrice) * 100).toFixed(2)) : 0,
    },
    event_counts: eventCounts,
    sections,
    sessions: sessions.sort((a, b) => new Date(b.last_event_at) - new Date(a.last_event_at)),
  };
}

/* =========================================================
   ROTAS DE VIEW
========================================================= */
app.get("/", (req, res) => {
  const indexPath = path.join(ROOT_DIR, "index.html");
  const upsellPath = path.join(ROOT_DIR, "upsell.html");

  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }

  if (fs.existsSync(upsellPath)) {
    return res.sendFile(upsellPath);
  }

  return res.send(`
    <html>
      <head><title>Tracking Heatmap</title></head>
      <body style="font-family: Arial; padding: 24px;">
        <h1>Servidor ativo</h1>
        <p>O servidor está rodando, mas não achei um <strong>index.html</strong> nem <strong>upsell.html</strong> na raiz.</p>
      </body>
    </html>
  `);
});

app.get("/dashboard", (req, res) => {
  const dashboardPath = path.join(ROOT_DIR, "dashboard.html");
  if (fs.existsSync(dashboardPath)) {
    return res.sendFile(dashboardPath);
  }

  return res.status(404).send(`
    <html>
      <head><title>Dashboard não encontrado</title></head>
      <body style="font-family: Arial; padding: 24px;">
        <h1>dashboard.html não encontrado</h1>
        <p>O arquivo do dashboard não foi encontrado na raiz.</p>
      </body>
    </html>
  `);
});

/* =========================================================
   API TRACK
========================================================= */
app.post("/api/track", async (req, res) => {
  try {
    const eventData = normalizeEvent(req.body || {}, req);

    if (!eventData.event_type) {
      return res.status(400).json({
        ok: false,
        error: "event_type é obrigatório",
      });
    }

    await insertEvent(eventData);

    return res.json({
      ok: true,
      stored: true,
      session_id: eventData.session_id,
      event_id: eventData.id,
    });
  } catch (error) {
    console.error("Erro em /api/track:", error);
    return res.status(500).json({
      ok: false,
      error: "Falha ao gravar evento",
    });
  }
});

/* =========================================================
   API DASHBOARD
========================================================= */
app.get("/api/dashboard/summary", async (req, res) => {
  try {
    const days = req.query.days ? Number(req.query.days) : 7;
    const page = safeString(req.query.page || "", 120);

    const events = await readEvents({ days, page });
    const summary = summarizeEvents(events);

    return res.json({
      ok: true,
      filters: { days, page },
      ...summary,
    });
  } catch (error) {
    console.error("Erro em /api/dashboard/summary:", error);
    return res.status(500).json({
      ok: false,
      error: "Falha ao montar resumo",
    });
  }
});

app.get("/api/dashboard/sessions", async (req, res) => {
  try {
    const days = req.query.days ? Number(req.query.days) : 7;
    const page = safeString(req.query.page || "", 120);

    const events = await readEvents({ days, page });
    const sessions = summarizeSessions(events).sort(
      (a, b) => new Date(b.last_event_at) - new Date(a.last_event_at)
    );

    return res.json({
      ok: true,
      total: sessions.length,
      sessions,
    });
  } catch (error) {
    console.error("Erro em /api/dashboard/sessions:", error);
    return res.status(500).json({
      ok: false,
      error: "Falha ao listar sessões",
    });
  }
});

app.get("/api/dashboard/raw-events", async (req, res) => {
  try {
    const days = req.query.days ? Number(req.query.days) : 3;
    const limit = req.query.limit ? Number(req.query.limit) : 300;
    const page = safeString(req.query.page || "", 120);

    let events = await readEvents({ days, page });
    events = events.slice(0, limit);

    return res.json({
      ok: true,
      total: events.length,
      events,
    });
  } catch (error) {
    console.error("Erro em /api/dashboard/raw-events:", error);
    return res.status(500).json({
      ok: false,
      error: "Falha ao listar eventos brutos",
    });
  }
});

app.delete("/api/dashboard/clear", async (req, res) => {
  try {
    await run(`DELETE FROM lead_events`);

    return res.json({
      ok: true,
      cleared: true,
    });
  } catch (error) {
    console.error("Erro em /api/dashboard/clear:", error);
    return res.status(500).json({
      ok: false,
      error: "Falha ao limpar eventos",
    });
  }
});

/* =========================================================
   START
========================================================= */
async function start() {
  await openDb();
  await initDb();

  app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`🗄️ Banco SQLite: ${DB_PATH}`);
  });
}

start().catch((error) => {
  console.error("Erro ao iniciar servidor:", error);
  process.exit(1);
});
