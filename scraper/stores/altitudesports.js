'use strict';

// Altitude Sports' catalogue is served from Algolia (public search-only key, same as their site).
// Carries many brands whose own sites block scraping (Under Armour, Patagonia, Arc'teryx, TNF…).

const { tag } = require('../tagger');

const STORE_NAME = 'Altitude Sports';
const STORE_KEY = 'altitudesports';
const API = 'https://i2q2bwze3k-dsn.algolia.net/1/indexes/PRODUCTS_ALS_en-CA/query';
const HEADERS = { 'X-Algolia-Application-Id': 'I2Q2BWZE3K', 'X-Algolia-API-Key': '8b62285e596a476fadc22970ed58e04a' };
const ATTRS = ['slug', 'name', 'price', 'original_price', 'image_url', 'discounted_percent', 'attributes.brand_name', 'attributes.gender'];

async function query(lo, hi) {
  const params = new URLSearchParams({
    hitsPerPage: 1000,
    numericFilters: JSON.stringify([`discounted_percent>=${lo}`, `discounted_percent<=${hi}`]),
    attributesToRetrieve: JSON.stringify(ATTRS),
    attributesToHighlight: '[]',
  });
  const res = await fetch(API, { method: 'POST', headers: HEADERS, body: JSON.stringify({ params: params.toString() }) });
  if (!res.ok) throw new Error(`Algolia HTTP ${res.status}`);
  return res.json();
}

// Algolia returns at most 1000 hits per query, so split the discount range until each slice fits
async function collect(lo, hi, out) {
  const j = await query(lo, hi);
  if (j.nbHits > 1000 && hi > lo) {
    const mid = Math.floor((lo + hi) / 2);
    await collect(lo, mid, out);
    await collect(mid + 1, hi, out);
  } else {
    out.push(...j.hits);
  }
}

async function scrape(_browser, onProgress = () => {}) {
  const hits = [];
  await collect(1, 100, hits);
  const deals = [];
  const seen = new Set();
  for (const h of hits) {
    const price = [].concat(h.price?.CAD?.centAmount)[0] / 100;
    const originalPrice = [].concat(h.original_price?.CAD?.centAmount)[0] / 100;
    if (seen.has(h.objectID) || !h.name || !(originalPrice > price) || !(price > 0)) continue;
    seen.add(h.objectID);
    const brand = h.attributes?.brand_name || '';
    const name = brand && !h.name.startsWith(brand) ? `${brand} ${h.name}` : h.name;
    deals.push({
      id: `${STORE_KEY}-${h.objectID}`,
      store: STORE_NAME, storeKey: STORE_KEY, name,
      url: `https://www.altitude-sports.com/p/${h.slug}`,
      image: h.image_url || '',
      price, originalPrice,
      discount: Math.round((1 - price / originalPrice) * 100),
      currency: 'CAD', priceCAD: price, originalPriceCAD: originalPrice,
      tags: tag({ name, gender: [].concat(h.attributes?.gender || []).length === 1 ? h.attributes.gender[0] : '' }),
      scrapedAt: new Date().toISOString(),
    });
  }
  onProgress(`${STORE_NAME}: ${deals.length} deals`);
  return deals;
}

module.exports = { scrape, STORE_KEY };
