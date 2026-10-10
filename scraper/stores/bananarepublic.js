'use strict';
const { scrapeGapInc } = require('../gapinc');

const STORE_KEY = 'bananarepublic';
const scrape = (browser, onProgress = () => {}) =>
  scrapeGapInc(browser, onProgress, { storeKey: STORE_KEY, storeName: 'Banana Republic', host: 'bananarepublic.gapcanada.ca', brand: 'br', cids: ['26495', '26219'] });

module.exports = { scrape, STORE_KEY };
