'use strict';

const fetch = require('node-fetch');
const { tag } = require('../tagger');

const STORE_NAME = 'Uniqlo';
const STORE_KEY = 'uniqlo';

// Uniqlo Canada — Fast Retailing platform
// Direct API approach: x-fr-clientid is a fixed value (uq.ca.web-spa), not dynamic.
// Product on sale when prices.promo !== null && prices.promo.value < prices.base.value
// Currently 0 sale items on Uniqlo CA — scraper will work when they run sales.

const API_BASE = 'https://www.uniqlo.com/ca/api/commerce/v5/en';
const API_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  'x-fr-clientid': 'uq.ca.web-spa',
  'x-fr-client-version': '3.2500.2',
  'Accept': 'application/json',
  'Accept-Language': 'en-CA,en;q=0.9',
  'Referer': 'https://www.uniqlo.com/ca/en/',
};

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('Uniqlo: scanning all products for sale prices…');

  const allDeals = [];
  const limit = 100;
  let offset = 0;
  let total = Infinity;
  let pages = 0;

  while (offset < total) {
    const url = `${API_BASE}/products?limit=${limit}&offset=${offset}&httpFailure=true`;
    let data;
    try {
      const resp = await fetch(url, { headers: API_HEADERS, timeout: 15000 });
      if (!resp.ok) {
        onProgress(`Uniqlo: API returned ${resp.status}, stopping`);
        break;
      }
      data = await resp.json();
    } catch (err) {
      onProgress(`Uniqlo: fetch error — ${err.message}`);
      break;
    }

    if (data.status !== 'ok' || !data.result) break;

    const { items = [], pagination = {} } = data.result;
    total = pagination.total ?? 0;

    for (const item of items) {
      const basePrice = item.prices?.base?.value;
      const promoPrice = item.prices?.promo?.value;

      if (!promoPrice || !basePrice || promoPrice >= basePrice) continue;

      const discount = Math.round((1 - promoPrice / basePrice) * 100);
      if (discount <= 0) continue;

      const productId = item.productId || '';
      const name = item.name || '';
      if (!name || !productId) continue;

      const productUrl = `https://www.uniqlo.com/ca/en/products/${productId}/`;

      // Build image URL from representative color code
      const colorCode = item.representative?.l2Id || item.representative?.communicationCode?.split('-')[0] || '';
      const baseId = productId.replace(/^E/, '').split('-')[0];
      const image = colorCode
        ? `https://image.uniqlo.com/UQ/ST3/WesternCommon/imagesgoods/${baseId}/item/00_${baseId}.jpg`
        : '';

      const gender = item.genderName === 'MEN' ? 'Men' : item.genderName === 'WOMEN' ? 'Women' : 'Unisex';

      allDeals.push({
        id: slugify(`${STORE_KEY}-${name}-${productId}`),
        store: STORE_NAME,
        storeKey: STORE_KEY,
        name: name.trim(),
        url: productUrl,
        image,
        price: promoPrice,
        originalPrice: basePrice,
        discount,
        currency: 'CAD',
        priceCAD: promoPrice,
        originalPriceCAD: basePrice,
        tags: tag({ name, gender }),
        scrapedAt: new Date().toISOString(),
      });
    }

    pages++;
    offset += limit;
    onProgress(`Uniqlo: scanned ${Math.min(offset, total)}/${total} products, ${allDeals.length} on sale…`);
  }

  onProgress(`Uniqlo: found ${allDeals.length} deals`);
  return allDeals;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
