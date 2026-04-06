'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Lacoste';
const STORE_KEY = 'lacoste';
const CURRENCY = 'CAD';

/**
 * Lacoste Canada scraper
 *
 * NOTE: As of April 2026, www.lacoste.com/ca/en/ redirects to other sites (Converse, Ralph Lauren).
 * The Lacoste Canada online store appears to be non-operational or has been shut down.
 * This scraper returns 0 deals until a valid sale URL can be identified.
 *
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('Lacoste: store appears offline or redirecting — returning 0 deals');
  return [];
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
