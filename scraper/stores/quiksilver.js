'use strict';
const { scrapeShopify } = require('../shopify');

const STORE_KEY = 'quiksilver';
const scrape = (browser, onProgress = () => {}) => scrapeShopify(browser, onProgress, {
  storeKey: STORE_KEY,
  storeName: 'Quiksilver',
  origin: 'https://www.quiksilver.com',
  collections: ['sale', 'mens-sale', 'womens-sale'],
});

module.exports = { scrape, STORE_KEY };
