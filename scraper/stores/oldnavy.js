'use strict';
const { scrapeGapInc } = require('../gapinc');

const STORE_KEY = 'oldnavy';
const scrape = (browser, onProgress = () => {}) =>
  scrapeGapInc(browser, onProgress, { storeKey: STORE_KEY, storeName: 'Old Navy CA', host: 'oldnavy.gapcanada.ca', brand: 'on', cids: [{ cid: '26061', gender: 'Men' }, { cid: '26190', gender: 'Women' }, '3034780'] });

module.exports = { scrape, STORE_KEY };
