'use strict';
const { scrapeShopify } = require('../shopify');

const STORE_KEY = 'nobull';
const scrape = (browser, onProgress = () => {}) => scrapeShopify(browser, onProgress, {
  storeKey: STORE_KEY,
  storeName: 'Nobull',
  origin: 'https://nobullproject.com',
  collections: ['mens-sale', '30-select-sale', 'flash-sale', 'mens-new-markdowns'],
});

module.exports = { scrape, STORE_KEY };
