'use strict';
const { scrapeShopify } = require('../shopify');

const STORE_KEY = 'youngla';
const scrape = (browser, onProgress = () => {}) => scrapeShopify(browser, onProgress, {
  storeKey: STORE_KEY,
  storeName: 'YoungLA',
  origin: 'https://youngla.com',
  collections: ['sale'],
});

module.exports = { scrape, STORE_KEY };
