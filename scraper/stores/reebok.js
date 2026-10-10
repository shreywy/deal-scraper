'use strict';
const { scrapeShopify } = require('../shopify');

const STORE_KEY = 'reebok';
const scrape = (browser, onProgress = () => {}) => scrapeShopify(browser, onProgress, {
  storeKey: STORE_KEY,
  storeName: 'Reebok CA',
  origin: 'https://reebok.ca',
  collections: ['sale'],
});

module.exports = { scrape, STORE_KEY };
