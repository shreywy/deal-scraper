'use strict';
const { scrapeShopify } = require('../shopify');

const STORE_KEY = 'converse';
const scrape = (browser, onProgress = () => {}) => scrapeShopify(browser, onProgress, {
  storeKey: STORE_KEY,
  storeName: 'Converse',
  origin: 'https://converse.ca',
  collections: ['sale'],
});

module.exports = { scrape, STORE_KEY };
