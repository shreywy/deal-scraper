'use strict';
const { scrapeShopify } = require('../shopify');

const STORE_KEY = 'obey';
const scrape = (browser, onProgress = () => {}) => scrapeShopify(browser, onProgress, {
  storeKey: STORE_KEY,
  storeName: 'Obey Clothing',
  origin: 'https://www.obeyclothing.com',
  collections: ['men-sale', 'womens-sale', 'sale-accessories', 'sale-bottoms', 'sale-headwear'],
});

module.exports = { scrape, STORE_KEY };
