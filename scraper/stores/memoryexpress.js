'use strict';

const STORE_NAME = 'Memory Express';
const STORE_KEY = 'memoryexpress';
const CURRENCY = 'CAD';

/**
 * Scrapes deals from Memory Express
 * @param {Object} browser - Playwright browser instance
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Array>} Array of deal objects
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('Memory Express: clearance items are in-store only, not available online');
  return [];
}


/**
 * Create a URL-safe slug from a string
 */
function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
