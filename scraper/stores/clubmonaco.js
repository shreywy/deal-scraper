'use strict';
const { scrapeShopify } = require('../shopify');

const STORE_KEY = 'clubmonaco';
const scrape = (browser, onProgress = () => {}) => scrapeShopify(browser, onProgress, {
  storeKey: STORE_KEY,
  storeName: 'Club Monaco CA',
  origin: 'https://www.clubmonaco.ca',
  collections: ['sale'],
});

module.exports = { scrape, STORE_KEY };
