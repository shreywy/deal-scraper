'use strict';
const { scrapeShopify } = require('../shopify');

const STORE_KEY = 'huf';
const scrape = (browser, onProgress = () => {}) => scrapeShopify(browser, onProgress, {
  storeKey: STORE_KEY,
  storeName: 'HUF',
  origin: 'https://www.hufworldwide.com',
  collections: ['sale'],
});

module.exports = { scrape, STORE_KEY };
