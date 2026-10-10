'use strict';
const { scrapeShopify } = require('../shopify');

const STORE_KEY = 'alphalete';
const scrape = (browser, onProgress = () => {}) => scrapeShopify(browser, onProgress, {
  storeKey: STORE_KEY,
  storeName: 'Alphalete',
  origin: 'https://alphaleteathletics.com',
  collections: ['mens-last-chance-items', 'womens-last-chance-items'],
});

module.exports = { scrape, STORE_KEY };
