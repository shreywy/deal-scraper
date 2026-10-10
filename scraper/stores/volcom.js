'use strict';
const { scrapeShopify } = require('../shopify');

const STORE_KEY = 'volcom';
const scrape = (browser, onProgress = () => {}) => scrapeShopify(browser, onProgress, {
  storeKey: STORE_KEY,
  storeName: 'Volcom',
  origin: 'https://www.volcom.com',
  collections: ['sale'],
});

module.exports = { scrape, STORE_KEY };
