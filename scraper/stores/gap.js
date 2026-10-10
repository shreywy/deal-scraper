'use strict';
const { scrapeGapInc } = require('../gapinc');

const STORE_KEY = 'gap';
const scrape = (browser, onProgress = () => {}) =>
  scrapeGapInc(browser, onProgress, { storeKey: STORE_KEY, storeName: 'Gap CA', host: 'www.gapcanada.ca', brand: 'gap', cids: [{ cid: '1065871', gender: 'Women' }, { cid: '1065870', gender: 'Men' }] });

module.exports = { scrape, STORE_KEY };
