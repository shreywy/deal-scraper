'use strict';
const { scrapeShopify } = require('../shopify');

const STORE_KEY = 'thebrick';
const scrape = (browser, onProgress = () => {}) => scrapeShopify(browser, onProgress, {
  storeKey: STORE_KEY,
  storeName: 'The Brick',
  origin: 'https://www.thebrick.com',
  collections: ['sale'],
});

module.exports = { scrape, STORE_KEY };
