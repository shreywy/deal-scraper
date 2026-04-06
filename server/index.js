'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { runAll, loadCache } = require('../scraper/index');

const CONFIG_PATH = path.join(__dirname, '../config.json');

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ── Scrape state ──────────────────────────────────────────────────────────────
let scrapeInProgress = false;
// Live per-store progress while a scrape runs: { key: { status, count, error } }
let liveStoreProgress = {};

// ── SSE broadcast ─────────────────────────────────────────────────────────────
// All connected /api/refresh clients receive every scrape event.
const sseClients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const send of sseClients) {
    try { send(msg); } catch (_) {}
  }
}

// ── GET /api/deals ──────────────────────────────────────────────────────────
app.get('/api/deals', (req, res) => {
  const cache = loadCache();
  if (!cache) return res.sendStatus(204);
  res.json(cache);
});

// ── DELETE /api/cache ────────────────────────────────────────────────────────
app.delete('/api/cache', (req, res) => {
  const CACHE_PATH = path.join(__dirname, '../data/deals.json');
  try {
    if (fs.existsSync(CACHE_PATH)) fs.unlinkSync(CACHE_PATH);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/status ──────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  const cache = loadCache();
  if (!cache) return res.json({
    scrapedAt: null, dealCount: 0, storeResults: {}, usdToCAD: null,
    scrapeInProgress, liveStoreProgress,
  });
  res.json({
    scrapedAt: cache.scrapedAt,
    dealCount: cache.deals.length,
    usdToCAD: cache.usdToCAD || null,
    storeResults: cache.storeResults || {},
    scrapeInProgress,
    liveStoreProgress,
  });
});

// ── GET /api/config ─────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json(loadConfig());
});

// ── PATCH /api/config ────────────────────────────────────────────────────────
app.patch('/api/config', (req, res) => {
  const cfg = loadConfig();
  const body = req.body;

  if (body.stores) {
    for (const [key, val] of Object.entries(body.stores)) {
      if (cfg.stores[key]) Object.assign(cfg.stores[key], val);
    }
  }
  if (body.settings) {
    Object.assign(cfg.settings, body.settings);
  }

  saveConfig(cfg);
  res.json(cfg);
});

// ── GET /api/refresh ─────────────────────────────────────────────────────────
// SSE stream. If a scrape is already running, subscribe to live events.
// Otherwise trigger a new scrape and stream its events.
app.get('/api/refresh', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const send = (msg) => {
    try { res.write(msg); } catch (_) {}
  };

  sseClients.add(send);
  req.on('close', () => sseClients.delete(send));

  if (scrapeInProgress) {
    // Client joined mid-scrape — send current state snapshot so popdown renders
    send(`event: started\ndata: ${JSON.stringify({ liveStoreProgress })}\n\n`);
    return; // will receive future broadcast events as the scrape progresses
  }

  // Start a new scrape
  startScrape(loadConfig());
});

// ── Core scrape runner (used by /api/refresh and launch auto-scrape) ──────────
function startScrape(cfg) {
  if (scrapeInProgress) return;

  scrapeInProgress = true;
  liveStoreProgress = {};
  Object.entries(cfg.stores)
    .filter(([, s]) => s.enabled)
    .forEach(([key, s]) => {
      liveStoreProgress[key] = { name: s.name, status: 'pending', count: 0, error: null };
    });

  broadcast('started', { liveStoreProgress });

  const onPartial = (key, deals, errorMsg) => {
    const storeName = cfg.stores[key]?.name || key;
    if (errorMsg) {
      liveStoreProgress[key] = { name: storeName, status: 'error', count: 0, error: String(errorMsg).slice(0, 80) };
    } else {
      liveStoreProgress[key] = { name: storeName, status: 'done', count: deals.length, error: null };
    }
    broadcast('partial', { storeKey: key, count: deals.length, deals, liveStoreProgress });
  };

  // Safety: end scrape after 20 minutes
  const safetyTimer = setTimeout(() => {
    if (scrapeInProgress) {
      scrapeInProgress = false;
      liveStoreProgress = {};
      broadcast('error', { message: 'Scrape timed out after 20 minutes' });
      closeAllClients();
    }
  }, 20 * 60 * 1000);

  runAll(cfg,
    message => broadcast('progress', { message }),
    onPartial,
  )
    .then(deals => {
      clearTimeout(safetyTimer);
      broadcast('complete', { count: deals.length, scrapedAt: new Date().toISOString() });
    })
    .catch(err => {
      clearTimeout(safetyTimer);
      broadcast('error', { message: err.message });
    })
    .finally(() => {
      scrapeInProgress = false;
      closeAllClients();
    });
}

function closeAllClients() {
  // Signal clients the stream is done; they'll handle it and close EventSource
  // Actual response.end() is not accessible here since we only hold send functions,
  // so clients will naturally disconnect after receiving 'complete' or 'error'.
  sseClients.clear();
}

// ── Startup cache-age check ───────────────────────────────────────────────────
// Trigger a background scrape on launch if cache is missing or older than 12 hours.
function maybeAutoScrapeOnLaunch(cfg) {
  const cache = loadCache();
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

  if (cache && (Date.now() - new Date(cache.scrapedAt)) < TWELVE_HOURS_MS) {
    const ageMin = Math.round((Date.now() - new Date(cache.scrapedAt)) / 60000);
    console.log(`📦 Cache is ${ageMin}m old — no scrape needed on launch`);
    return;
  }

  const reason = cache ? 'cache is older than 12 hours' : 'no cache found';
  console.log(`⏰ Auto-scrape on launch: ${reason}…`);
  startScrape(cfg);
}

// ── Start ────────────────────────────────────────────────────────────────────
function start() {
  const cfg = loadConfig();
  const port = cfg.settings?.port || 3000;

  app.listen(port, () => {
    console.log(`\n🌿 dealsco running at http://localhost:${port}\n`);
    maybeAutoScrapeOnLaunch(cfg);
  });

  return port;
}

module.exports = { app, start };
