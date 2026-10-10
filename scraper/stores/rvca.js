'use strict';
const { scrapeShopify } = require('../shopify');

const STORE_KEY = 'rvca';
const scrape = (browser, onProgress = () => {}) => scrapeShopify(browser, onProgress, {
  storeKey: STORE_KEY,
  storeName: 'RVCA',
  origin: 'https://www.rvca.com',
  collections: [{ handle: 'mens-sale', gender: 'Men' }, { handle: 'womens-sale', gender: 'Women' }, 'all-sale'],
});

module.exports = { scrape, STORE_KEY };
