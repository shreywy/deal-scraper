'use strict';
const { scrapeShopify } = require('../shopify');

const STORE_KEY = 'reigningchamp';
const scrape = (browser, onProgress = () => {}) => scrapeShopify(browser, onProgress, {
  storeKey: STORE_KEY,
  storeName: 'Reigning Champ',
  origin: 'https://reigningchamp.com',
  collections: ['mens-sale', 'archive-sale'],
});

module.exports = { scrape, STORE_KEY };
