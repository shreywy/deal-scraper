'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'American Eagle';
const STORE_KEY = 'americaneagle';
const CURRENCY = 'CAD';

const SALE_PAGES = [
  { url: 'https://www.ae.com/ca/en/c/women/sale/cat7130020', gender: 'Women' },
  { url: 'https://www.ae.com/ca/en/c/men/sale/cat7130019', gender: 'Men' },
];

/**
 * American Eagle CA — Bot-blocked scraper.
 *
 * BLOCKED: American Eagle redirects sale category pages (cat7130019, cat7130020)
 * to homepage with "?redirectedFrom=plp" when accessed via headless browser,
 * even with stealth mode. This is an active bot detection mechanism.
 *
 * Tested approaches that failed:
 * - Direct API access (404)
 * - Playwright with stealth mode
 * - Enhanced headers and navigator overrides
 *
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('American Eagle: BLOCKED - sale pages redirect to homepage (bot detection)');
  return [];
}

module.exports = { scrape, STORE_KEY };
