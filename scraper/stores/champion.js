'use strict';
const { scrapeShopify } = require('../shopify');

const STORE_KEY = 'champion';
const scrape = (browser, onProgress = () => {}) => scrapeShopify(browser, onProgress, {
  storeKey: STORE_KEY,
  storeName: 'Champion',
  origin: 'https://www.champion.com',
  collections: ['all-sale', 'clearance'],
});

module.exports = { scrape, STORE_KEY };
