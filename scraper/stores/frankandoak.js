'use strict';
const { scrapeShopify } = require('../shopify');

const STORE_KEY = 'frankandoak';
const scrape = (browser, onProgress = () => {}) => scrapeShopify(browser, onProgress, {
  storeKey: STORE_KEY,
  storeName: 'Frank And Oak',
  origin: 'https://frankandoak.com',
  collections: ['sale-mens', 'sale', 'sale-womens'],
});

module.exports = { scrape, STORE_KEY };
