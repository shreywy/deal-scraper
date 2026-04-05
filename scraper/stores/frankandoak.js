'use strict';

const fetch = require('node-fetch');
const { tag } = require('../tagger');

const STORE_NAME = 'Frank And Oak';
const STORE_KEY = 'frankandoak';
const STORE_DOMAIN = 'frankandoak.com';
const CURRENCY = 'CAD';

/**
 * Frank and Oak — Canadian fashion brand on Shopify (CAD prices).
 * Uses the public /collections/sale/products.json endpoint.
 *
 * @param {import('playwright').Browser} _browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(_browser, onProgress = () => {}) {
  onProgress('Frank And Oak: fetching sale products…');

  const allProducts = [];
  let page = 1;

  while (true) {
    const url = `https://${STORE_DOMAIN}/collections/sale/products.json?limit=250&page=${page}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) {
      if (page === 1) throw new Error(`HTTP ${res.status}`);
      break;
    }
    const data = await res.json();
    const products = data.products || [];
    if (products.length === 0) break;
    allProducts.push(...products);
    onProgress(`Frank And Oak: fetched ${allProducts.length} products…`);
    if (products.length < 250) break;
    page++;
  }

  const seen = new Set();
  const deals = allProducts.map(p => mapProduct(p, seen)).filter(Boolean);
  onProgress(`Frank And Oak: found ${deals.length} deals`);
  return deals;
}

function mapProduct(product, seen) {
  try {
    const name = product.title || '';
    if (!name) return null;

    const handle = product.handle || slugify(name);
    const url = `https://${STORE_DOMAIN}/products/${handle}`;
    if (seen.has(url)) return null;
    seen.add(url);

    let price = null, originalPrice = null;
    for (const variant of (product.variants || [])) {
      const vPrice = parseFloat(variant.price);
      const vCompare = parseFloat(variant.compare_at_price || 0);
      if (vCompare > vPrice && (price === null || vPrice < price)) {
        price = vPrice;
        originalPrice = vCompare;
      }
    }
    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const image = product.images?.[0]?.src || '';

    // Gender from Shopify tags
    const tagArr = Array.isArray(product.tags)
      ? product.tags
      : String(product.tags || '').split(',');
    const tagStr = tagArr.join(' ').toLowerCase();
    const gender = /women|female|girl/.test(tagStr) ? 'Women'
      : /\bmen\b|male|boy/.test(tagStr) ? 'Men'
      : '';

    return {
      id: slugify(`${STORE_KEY}-${name}-${handle}`),
      store: STORE_NAME,
      storeKey: STORE_KEY,
      name,
      url,
      image,
      price,
      originalPrice,
      discount,
      currency: CURRENCY,
      priceCAD: price,
      originalPriceCAD: originalPrice,
      tags: tag({ name, gender }),
      scrapedAt: new Date().toISOString(),
    };
  } catch (_) { return null; }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
