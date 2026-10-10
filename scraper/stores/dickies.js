'use strict';
const { scrapeShopify } = require('../shopify');

const STORE_KEY = 'dickies';
const scrape = (browser, onProgress = () => {}) => scrapeShopify(browser, onProgress, {
  storeKey: STORE_KEY,
  storeName: 'Dickies',
  origin: 'https://www.dickies.com',
  collections: ['sale'],
});

module.exports = { scrape, STORE_KEY };
