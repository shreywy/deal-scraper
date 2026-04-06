'use strict';

const STORE_NAME = 'Lego CA';
const STORE_KEY = 'lego';

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('Lego CA: sale/deals pages return 404 on Canadian site');
  return [];
}

module.exports = { scrape, STORE_KEY };
