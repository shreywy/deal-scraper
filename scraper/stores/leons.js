'use strict';
const { scrapeShopify } = require('../shopify');

const STORE_KEY = 'leons';
const scrape = (browser, onProgress = () => {}) => scrapeShopify(browser, onProgress, {
  storeKey: STORE_KEY,
  storeName: "Leon's",
  origin: 'https://www.leons.ca',
  collections: ['sale-items'],
});

module.exports = { scrape, STORE_KEY };
