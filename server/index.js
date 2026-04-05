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

// ── GET /api/deals ──────────────────────────────────────────────────────────
// Returns cached deals immediately. 204 if no cache yet.
app.get('/api/deals', (req, res) => {
  const cache = loadCache();
  if (!cache) return res.sendStatus(204);
  res.json(cache);
});

// ── GET /api/status ──────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  const cache = loadCache();
  if (!cache) return res.json({ scrapedAt: null, dealCount: 0, storeResults: {}, usdToCAD: null, scrapeInProgress });
  res.json({
    scrapedAt: cache.scrapedAt,
    dealCount: cache.deals.length,
    usdToCAD: cache.usdToCAD || null,
    storeResults: cache.storeResults || {},
    scrapeInProgress,
  });
});

// ── GET /api/config ─────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json(loadConfig());
});

// ── PATCH /api/config ────────────────────────────────────────────────────────
// Merge patch — only updates keys provided in body.
app.patch('/api/config', (req, res) => {
  const cfg = loadConfig();
  const body = req.body;

  // Allow patching stores.*.enabled and settings.*
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
// Server-Sent Events stream. Triggers a scrape and streams progress back.
// The client subscribes once on load; the server emits events as scraping progresses.

let scrapeInProgress = false;

app.get('/api/refresh', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  if (scrapeInProgress) {
    send('progress', { message: 'Scrape already in progress…' });
    // Still keep connection open and close after a moment so client knows
    setTimeout(() => res.end(), 500);
    return;
  }

  scrapeInProgress = true;
  send('progress', { message: 'Starting scrape…' });

  const cfg = loadConfig();

  runAll(cfg, message => {
    send('progress', { message });
  })
    .then(deals => {
      send('complete', { count: deals.length, scrapedAt: new Date().toISOString() });
    })
    .catch(err => {
      send('error', { message: err.message });
    })
    .finally(() => {
      scrapeInProgress = false;
      res.end();
    });

  req.on('close', () => {
    // Client disconnected — scrape still runs to completion but we stop sending
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
    const cfg = loadConfig();
    try {
      const deals = await runAll(cfg, msg => console.log(`  ${msg}`));
      console.log(`✅ Scheduled scrape done — ${deals.length} deals\n`);
    } catch (err) {
      console.error(`❌ Scheduled scrape failed: ${err.message}\n`);
    } finally {
      scrapeInProgress = false;
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
    scheduleAutoScrape(cfg.settings?.refreshIntervalHours || 6);
  });

  return port;
}

module.exports = { app, start };
