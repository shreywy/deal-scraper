'use strict';

const fetch = require('node-fetch');
const { tag } = require('../tagger');
const { getUSDtoCAD } = require('../currency');

const STORE_NAME = 'Musinsa';
const STORE_KEY = 'musinsa';
const CURRENCY = 'USD';

// Musinsa Global (English) — Korean streetwear platform that ships worldwide.
// Their global store has a public product listing API.
const BASE_API = 'https://api.musinsa.com/api2/goodsls';

/**
 * Musinsa Global — Korean streetwear / fashion marketplace.
 * Ships internationally (including Canada). USD prices converted to CAD.
 *
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('Musinsa: fetching sale products…');

  const rate = await getUSDtoCAD();

  // Try direct API first
  try {
    const deals = await fetchFromAPI(rate, onProgress);
    if (deals.length > 0) {
      onProgress(`Musinsa: found ${deals.length} deals`);
      return deals;
    }
  } catch (err) {
    onProgress(`Musinsa: API failed (${err.message}), using browser…`);
  }

  return await browserScrape(browser, rate, onProgress);
}

async function fetchFromAPI(rate, onProgress) {
  const allDeals = [];
  const seen = new Set();
  let page = 1;

  while (true) {
    // Musinsa's sale/outlet product listing API (global English store)
    const url = `https://global.musinsa.com/api/goods/lists?page=${page}&sortCode=discount_rate&onSale=true&perPage=60`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://global.musinsa.com',
        'Referer': 'https://global.musinsa.com/sale',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const products = data?.data?.goods || data?.goods || data?.products || data?.items || [];
    if (!Array.isArray(products) || products.length === 0) break;

    for (const p of products) {
      const d = mapMusinsaProduct(p, seen, rate);
      if (d) allDeals.push(d);
    }
    onProgress(`Musinsa: fetched ${allDeals.length} deals…`);

    const total = data?.data?.totalCount || data?.totalCount || 0;
    if (allDeals.length >= total || products.length < 60) break;
    page++;
  }
  return allDeals;
}

function mapMusinsaProduct(p, seen, rate) {
  try {
    const name = p.goodsName || p.name || p.title || '';
    if (!name) return null;

    const priceUSD = parseFloat(p.salePrice || p.price?.sale || p.prices?.sale || p.goodsPrice || 0);
    const origUSD = parseFloat(p.normalPrice || p.price?.normal || p.originalPrice || p.goodsOriginPrice || 0);

    if (!priceUSD || !origUSD || priceUSD >= origUSD) return null;
    const discount = Math.round((1 - priceUSD / origUSD) * 100);
    if (discount <= 0) return null;

    const goodsNo = p.goodsNo || p.id || p.goodsId || '';
    const url = goodsNo
      ? `https://global.musinsa.com/en/goods/${goodsNo}`
      : p.goodsLinkUrl || '';
    if (!url || seen.has(url)) return null;
    seen.add(url);

    const image = p.goodsImageUrl || p.imageUrl || p.thumbnailImageUrl || '';
    const priceCAD = Math.round(priceUSD * rate * 100) / 100;
    const originalPriceCAD = Math.round(origUSD * rate * 100) / 100;

    return {
      id: slugify(`${STORE_KEY}-${name}-${goodsNo}`),
      store: STORE_NAME,
      storeKey: STORE_KEY,
      name,
      url,
      image,
      price: priceCAD,
      originalPrice: originalPriceCAD,
      discount,
      currency: CURRENCY,
      priceCAD,
      originalPriceCAD,
      tags: tag({ name }),
      scrapedAt: new Date().toISOString(),
    };
  } catch (_) { return null; }
}

async function browserScrape(browser, rate, onProgress) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });

  const rawProducts = [];
  const seenIds = new Set();

  context.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;
    if (!url.includes('musinsa.com')) return;
    try {
      const json = await response.json();
      const products = json?.data?.goods || json?.goods || json?.products || [];
      for (const p of (Array.isArray(products) ? products : [])) {
        const id = p.goodsNo || p.id;
        if (id && !seenIds.has(id)) { seenIds.add(id); rawProducts.push(p); }
      }
    } catch (_) {}
  });

  const page = await context.newPage();
  const seen = new Set();
  const allDeals = [];

  try {
    await page.goto('https://global.musinsa.com/en/sale', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);

    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
    }

    for (const p of rawProducts) {
      const d = mapMusinsaProduct(p, seen, rate);
      if (d) allDeals.push(d);
    }

    if (allDeals.length === 0) {
      const domDeals = await page.evaluate(({ storeName, storeKey }) => {
        const parsePrice = el => {
          const n = parseFloat((el?.textContent || '').replace(/[^0-9.]/g, ''));
          return isNaN(n) ? null : n;
        };
        const cards = document.querySelectorAll('[class*="goods-item"], [class*="product-item"], [class*="GoodsCard"]');
        const seen = new Set();
        return [...cards].map(card => {
          const link = card.querySelector('a[href]');
          const url = link?.href || '';
          if (!url || seen.has(url)) return null;
          seen.add(url);
          const name = card.querySelector('[class*="name"], [class*="title"]')?.textContent?.trim() || '';
          const origEl = card.querySelector('del, s, [class*="origin"], [class*="normal-price"]');
          const saleEl = card.querySelector('[class*="sale-price"], [class*="discount-price"], [class*="special-price"]');
          const imgEl = card.querySelector('img');
          const price = parsePrice(saleEl);
          const originalPrice = parsePrice(origEl);
          if (!name || !price || !originalPrice || price >= originalPrice) return null;
          const discount = Math.round((1 - price / originalPrice) * 100);
          if (discount <= 0) return null;
          return { store: storeName, storeKey, name, url, image: imgEl?.src || '', price, originalPrice, discount, tags: [] };
        }).filter(Boolean);
      }, { storeName: STORE_NAME, storeKey: STORE_KEY });
      allDeals.push(...domDeals);
    }
  } catch (err) {
    onProgress(`Musinsa: browser error — ${err.message}`);
  } finally {
    await page.close();
    await context.close();
  }

  const tagged = allDeals.map(d => ({
    ...d,
    id: d.id || slugify(`${STORE_KEY}-${d.name}`),
    currency: CURRENCY,
    priceCAD: d.priceCAD || Math.round(d.price * rate * 100) / 100,
    originalPriceCAD: d.originalPriceCAD || Math.round(d.originalPrice * rate * 100) / 100,
    tags: d.tags?.length ? d.tags : tag({ name: d.name }),
    scrapedAt: new Date().toISOString(),
  }));

  onProgress(`Musinsa: found ${tagged.length} deals`);
  return tagged;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
