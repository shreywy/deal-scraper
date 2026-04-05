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

// ── GET /api/deals ──────────────────────────────────────────────────────────
app.get('/api/deals', (req, res) => {
  const cache = loadCache();
  if (!cache) return res.sendStatus(204);
  res.json(cache);
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
// SSE stream. Triggers scrape and streams progress + partial results back.
app.get('/api/refresh', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  let closed = false;
  const send = (event, data) => {
    if (closed) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (_) {}
  };

  req.on('close', () => { closed = true; });

  if (scrapeInProgress) {
    // Return current progress snapshot so the client can show the popdown
    send('progress', { message: 'Scrape already in progress…', liveStoreProgress });
    setTimeout(() => { if (!closed) res.end(); }, 500);
    return;
  }

  scrapeInProgress = true;
  const cfg = loadConfig();

  // Initialise per-store progress to 'pending' for all enabled stores
  liveStoreProgress = {};
  Object.entries(cfg.stores)
    .filter(([, s]) => s.enabled)
    .forEach(([key, s]) => {
      liveStoreProgress[key] = { name: s.name, status: 'pending', count: 0, error: null };
    });

  send('started', { liveStoreProgress });

  // Called by the orchestrator when each store finishes
  const onPartial = (key, deals, errorMsg) => {
    const storeName = cfg.stores[key]?.name || key;
    if (errorMsg) {
      liveStoreProgress[key] = { name: storeName, status: 'error', count: 0, error: String(errorMsg).slice(0, 80) };
    } else {
      liveStoreProgress[key] = { name: storeName, status: 'done', count: deals.length, error: null };
    }
    send('partial', { storeKey: key, count: deals.length, deals, liveStoreProgress });
  };

  // Safety: forcibly end the scrape after 20 minutes to prevent permanent hang
  const safetyTimer = setTimeout(() => {
    if (scrapeInProgress) {
      scrapeInProgress = false;
      liveStoreProgress = {};
      send('error', { message: 'Scrape timed out after 20 minutes — some stores may not have loaded' });
      try { res.end(); } catch (_) {}
    }
  }, 20 * 60 * 1000);

  runAll(cfg,
    message => send('progress', { message }),
    onPartial,
  )
    .then(deals => {
      clearTimeout(safetyTimer);
      send('complete', { count: deals.length, scrapedAt: new Date().toISOString() });
    })
    .catch(err => {
      clearTimeout(safetyTimer);
      send('error', { message: err.message });
    })
    .finally(() => {
      scrapeInProgress = false;
      try { res.end(); } catch (_) {}
    });
});

// ── Scheduled auto-scrape ─────────────────────────────────────────────────────
function scheduleAutoScrape(intervalHours) {
  if (!intervalHours || intervalHours <= 0) return;
  const ms = intervalHours * 60 * 60 * 1000;

  setInterval(async () => {
    if (scrapeInProgress) {
      console.log('⏰ Scheduled scrape skipped — one already in progress');
      return;
    }
    console.log(`\n⏰ Scheduled scrape starting (every ${intervalHours}h)…`);
    scrapeInProgress = true;
    liveStoreProgress = {};
    const cfg = loadConfig();
    Object.entries(cfg.stores)
      .filter(([, s]) => s.enabled)
      .forEach(([key, s]) => {
        liveStoreProgress[key] = { name: s.name, status: 'pending', count: 0, error: null };
      });
    try {
      const deals = await runAll(cfg,
        msg => console.log(`  ${msg}`),
        (key, deals, err) => {
          const name = cfg.stores[key]?.name || key;
          liveStoreProgress[key] = err
            ? { name, status: 'error', count: 0, error: String(err).slice(0, 80) }
            : { name, status: 'done', count: deals.length, error: null };
        },
      );
      console.log(`✅ Scheduled scrape done — ${deals.length} deals\n`);
    } catch (err) {
      console.error(`❌ Scheduled scrape failed: ${err.message}\n`);
    } finally {
      scrapeInProgress = false;
      liveStoreProgress = {};
    }
  }, ms);

  console.log(`⏰ Auto-scrape scheduled every ${intervalHours}h`);
}

// ── Start ────────────────────────────────────────────────────────────────────
function start() {
  const cfg = loadConfig();
  const port = cfg.settings?.port || 3000;

  app.listen(port, () => {
    console.log(`\n🌿 dealsco running at http://localhost:${port}\n`);
    scheduleAutoScrape(cfg.settings?.refreshIntervalHours || 24);
  });

  return port;
}

module.exports = { app, start };
