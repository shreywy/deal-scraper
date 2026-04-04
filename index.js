'use strict';

const { start } = require('./server/index');
const { loadCache } = require('./scraper/index');
const open = require('open');

async function main() {
  // Start the web server
  const port = start();

  // Report cache status in the console
  const cache = loadCache();
  if (cache) {
    const age = Math.round((Date.now() - new Date(cache.scrapedAt)) / 60000);
    console.log(`📦 Cache: ${cache.deals.length} deals from ${age}m ago`);
  } else {
    console.log('📦 No cache yet — scraping will begin when the page loads');
  }

  // Open browser. The page's SSE connection will trigger the scrape automatically.
  setTimeout(() => open(`http://localhost:${port}`), 800);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
