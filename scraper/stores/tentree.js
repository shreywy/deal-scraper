'use strict';
const { scrapeShopify } = require('../shopify');

const STORE_KEY = 'tentree';
const scrape = (browser, onProgress = () => {}) => scrapeShopify(browser, onProgress, {
  storeKey: STORE_KEY,
  storeName: 'Tentree',
  origin: 'https://www.tentree.ca',
  collections: ['sale'],
});

module.exports = { scrape, STORE_KEY };
