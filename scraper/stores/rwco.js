'use strict';
const { scrapeShopify } = require('../shopify');

const STORE_KEY = 'rwco';
const scrape = (browser, onProgress = () => {}) => scrapeShopify(browser, onProgress, {
  storeKey: STORE_KEY,
  storeName: 'RW&CO',
  origin: 'https://www.rw-co.com',
  collections: ['sale'],
});

module.exports = { scrape, STORE_KEY };
