'use strict';

const { start } = require('./server/index');
const { runAll, loadCache } = require('./scraper/index');
const fs = require('fs');
const path = require('path');

async function main() {
  // Start the web server
  start();

  // Auto-refresh on launch if configured
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch (_) {
    cfg = { settings: { autoRefreshOnLaunch: true } };
  }

  if (cfg.settings?.autoRefreshOnLaunch !== false) {
    const cache = loadCache();
    if (cache) {
      console.log(`📦 Serving ${cache.deals.length} cached deals from ${cache.scrapedAt}`);
    } else {
      console.log('📦 No cache yet — first run will take a moment');
    }

    console.log('🔄 Scraping in background…\n');
    runAll(cfg, msg => console.log(`  ${msg}`))
      .then(deals => console.log(`\n✅ Scrape complete — ${deals.length} deals`))
      .catch(err => console.error(`\n❌ Scrape error: ${err.message}`));
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
