'use strict';
const { scrapeGapInc } = require('../gapinc');

const STORE_KEY = 'oldnavy';
const scrape = (browser, onProgress = () => {}) =>
  scrapeGapInc(browser, onProgress, { storeKey: STORE_KEY, storeName: 'Old Navy CA', host: 'oldnavy.gapcanada.ca', brand: 'on', cids: ['3034780', '26190', '26061'] });

module.exports = { scrape, STORE_KEY };
