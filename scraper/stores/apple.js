'use strict';

// Apple Canada Refurbished Store
// Parses JSON-LD (product name/price/image) + HTML savings data (original price comparison).
// No Playwright needed — pure fetch.

const fetch = require('node-fetch');

const STORE_NAME = 'Apple CA';
const STORE_KEY = 'apple';
const CURRENCY = 'CAD';
const BASE_URL = 'https://www.apple.com/ca/shop/refurbished';

const CATEGORIES = ['mac', 'iphone', 'ipad', 'accessories', 'appletv'];

function ncTag(name) {
  const t = name.toLowerCase();
  if (/macbook|mac mini|mac pro|mac studio|imac/.test(t)) return 'Computers';
  if (/iphone/.test(t)) return 'Phones & Tablets';
  if (/ipad/.test(t)) return 'Phones & Tablets';
  if (/apple tv/.test(t)) return 'Electronics';
  if (/airpods|homepod|beats/.test(t)) return 'Audio';
  if (/apple watch/.test(t)) return 'Electronics';
  if (/apple pencil|magic keyboard|magic mouse|magic trackpad/.test(t)) return 'Computer Parts';
  return 'Electronics';
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

async function scrapeCategory(slug, onProgress) {
  const url = `${BASE_URL}/${slug}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html',
      'Accept-Language': 'en-CA,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();

  // 1. Extract JSON-LD Product blocks: partNumber → {name, url, price, image}
  const jsonldMap = {};
  for (const [, raw] of text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(raw.trim());
      if (d['@type'] !== 'Product') continue;
      const sku = d.offers?.[0]?.sku;
      if (!sku) continue;
      jsonldMap[sku] = {
        name: d.name || '',
        url: d.url || '',
        price: d.offers[0].price,
        image: d.image || '',
      };
    } catch (_) {}
  }

  // 2. Extract savings per partNumber from embedded HTML data
  // Pattern: "savings":"Save $XXX.XX","priceCurrency":"CAD","partNumber":"XXXXXX"
  const savingsMap = {};
  for (const [, savTxt, pn] of text.matchAll(/"savings":"(Save [^"]+)","priceCurrency":"CAD","partNumber":"([A-Z0-9\/]+)"/g)) {
    const amount = parseFloat(savTxt.replace(/[^0-9.]/g, ''));
    if (!isNaN(amount) && amount > 0) savingsMap[pn] = amount;
  }

  // 3. Combine: match by SKU = partNumber
  const deals = [];
  for (const [pn, savings] of Object.entries(savingsMap)) {
    const product = jsonldMap[pn];
    if (!product || !product.name || !product.url || !product.price) continue;

    const refurbPrice = product.price;
    const originalPrice = Math.round((refurbPrice + savings) * 100) / 100;
    if (refurbPrice >= originalPrice) continue;

    const discount = Math.round((savings / originalPrice) * 100);
    if (discount <= 0) continue;

    deals.push({
      id: slugify(`apple-${pn}`),
      store: STORE_NAME,
      storeKey: STORE_KEY,
      name: product.name,
      url: product.url,
      image: product.image,
      price: Math.round(refurbPrice * 100) / 100,
      originalPrice,
      discount,
      currency: CURRENCY,
      priceCAD: Math.round(refurbPrice * 100) / 100,
      originalPriceCAD: originalPrice,
      tags: ['Non-Clothing', ncTag(product.name)],
      scrapedAt: new Date().toISOString(),
    });
  }

  onProgress(`Apple CA: ${slug} — ${Object.keys(jsonldMap).length} products, ${deals.length} deals`);
  return deals;
}

/**
 * @param {import('playwright').Browser} _browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(_browser, onProgress = () => {}) {
  const allDeals = [];
  const seen = new Set();

  for (const cat of CATEGORIES) {
    try {
      const deals = await scrapeCategory(cat, onProgress);
      for (const d of deals) {
        if (!seen.has(d.id)) {
          seen.add(d.id);
          allDeals.push(d);
        }
      }
    } catch (err) {
      onProgress(`Apple CA: error on ${cat} — ${err.message}`);
    }
  }

  onProgress(`Apple CA: total ${allDeals.length} deals`);
  return allDeals;
}

module.exports = { scrape, STORE_KEY };
