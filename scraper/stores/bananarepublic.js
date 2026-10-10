'use strict';
const { scrapeGapInc } = require('../gapinc');

const STORE_KEY = 'bananarepublic';
const scrape = (browser, onProgress = () => {}) =>
  scrapeGapInc(browser, onProgress, { storeKey: STORE_KEY, storeName: 'Banana Republic', host: 'bananarepublic.gapcanada.ca', brand: 'br', cids: [{ cid: '26495', gender: 'Women' }, { cid: '26219', gender: 'Men' }] });

module.exports = { scrape, STORE_KEY };
