'use strict';
const { scrapeShopify } = require('../shopify');

const STORE_KEY = 'reitmans';
const scrape = (browser, onProgress = () => {}) => scrapeShopify(browser, onProgress, {
  storeKey: STORE_KEY,
  storeName: 'Reitmans',
  origin: 'https://www.reitmans.com',
  collections: [{ handle: 'sale-clothing', gender: 'Women' }, { handle: 'sale-accessories', gender: 'Women' }],
});

module.exports = { scrape, STORE_KEY };
