'use strict';
const { scrapeGapInc } = require('../gapinc');

const STORE_KEY = 'gap';
const scrape = (browser, onProgress = () => {}) =>
  scrapeGapInc(browser, onProgress, { storeKey: STORE_KEY, storeName: 'Gap CA', host: 'www.gapcanada.ca', brand: 'gap', cids: ['1065871', '1065870'] });

module.exports = { scrape, STORE_KEY };
