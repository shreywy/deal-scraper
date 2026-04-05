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
    // Updated to use SALE sortCode and salePriceFilter
    const url = `https://global.musinsa.com/api/goods/lists?page=${page}&sortCode=SALE&salePriceFilter=true&perPage=60`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://global.musinsa.com',
        'Referer': 'https://global.musinsa.com/en/sale',
        'Cookie': 'country_code=US; language=en',
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

  // Add location cookies before navigation to avoid redirect
  await context.addCookies([
    { name: 'country_code', value: 'US', domain: '.musinsa.com', path: '/' },
    { name: 'language', value: 'en', domain: '.musinsa.com', path: '/' }
  ]);

  const rawProducts = [];
  const seenIds = new Set();

  context.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;
    if (!url.includes('musinsa.com')) return;

    // Log intercepted API calls for debugging
    if (url.includes('/api/') || url.includes('goods') || url.includes('product')) {
      onProgress(`Musinsa: intercepted API call: ${url.substring(0, 80)}…`);
    }

    try {
      const json = await response.json();
      // Enhanced XHR interception - look for goods/products in multiple locations
      const products = json?.data?.goods || json?.goods || json?.products || json?.data?.list || [];
      if (Array.isArray(products) && products.length > 0) {
        onProgress(`Musinsa: found ${products.length} products in API response`);
      }
      for (const p of (Array.isArray(products) ? products : [])) {
        const id = p.goodsNo || p.id || p.goodsId;
        if (id && !seenIds.has(id)) { seenIds.add(id); rawProducts.push(p); }
      }
    } catch (_) {}
  });

  const page = await context.newPage();
  const seen = new Set();
  const allDeals = [];

  try {
    // Navigate directly to /en/ path with location info in URL if possible
    onProgress('Musinsa: navigating to sale page…');
    await page.goto('https://global.musinsa.com/en/sale', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);

    // Check if we hit location chooser - if so, try to select USA
    const pageText = await page.textContent('body');
    if (pageText && pageText.includes('CHOOSE YOUR LOCATION')) {
      onProgress('Musinsa: bypassing location chooser…');

      // Try multiple strategies to select location
      try {
        // Strategy 1: Click visible USA/US button
        await page.click('text=/United States|USA|US/i', { timeout: 5000 });
        await page.waitForTimeout(2000);
      } catch (_) {
        try {
          // Strategy 2: Click any location to proceed (e.g., first available)
          await page.click('button:has-text("Japan"), button:has-text("Hong Kong"), a:has-text("Japan")', { timeout: 3000 });
          await page.waitForTimeout(2000);
        } catch (__) {
          // Strategy 3: Use context addCookies and reload
          await context.addCookies([
            { name: 'isShownLocation', value: 'true', domain: '.musinsa.com', path: '/' },
            { name: 'selectedCountry', value: 'US', domain: '.musinsa.com', path: '/' },
          ]);
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(3000);
        }
      }
    }

    await page.waitForTimeout(3000);

    onProgress('Musinsa: scrolling to load products…');
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
    }

    for (const p of rawProducts) {
      const d = mapMusinsaProduct(p, seen, rate);
      if (d) allDeals.push(d);
    }

    onProgress(`Musinsa: captured ${allDeals.length} deals from XHR, trying DOM scrape…`);

    // Debug: check page content
    const pageTitle = await page.title();
    const bodyText = await page.evaluate(() => document.body?.textContent?.substring(0, 200));
    onProgress(`Musinsa: page title="${pageTitle}", body preview="${bodyText}"`);

    const domDeals = await page.evaluate(({ storeName, storeKey }) => {
        const parsePrice = el => {
          if (!el) return null;
          const text = el.textContent || '';
          const n = parseFloat(text.replace(/[^0-9.]/g, ''));
          return isNaN(n) ? null : n;
        };

        // Try multiple selector patterns
        const selectors = [
          '[class*="goods-item"]',
          '[class*="product-item"]',
          '[class*="GoodsCard"]',
          '[class*="ProductCard"]',
          '[class*="product-card"]',
          'article[class*="product"]',
          'li[class*="product"]',
          '[data-goods-no]'
        ];

        let cards = [];
        for (const sel of selectors) {
          cards = [...document.querySelectorAll(sel)];
          if (cards.length > 0) break;
        }

        const seen = new Set();
        return [...cards].map(card => {
          const link = card.querySelector('a[href]');
          const url = link?.href || '';
          if (!url || seen.has(url)) return null;
          seen.add(url);

          const nameEl = card.querySelector('[class*="name"], [class*="title"], h2, h3, h4, p[class*="name"]');
          const name = nameEl?.textContent?.trim() || '';

          // Try multiple price selectors
          const origEl = card.querySelector('del, s, [class*="origin"], [class*="normal"], [class*="before"], [class*="was"]');
          const saleEl = card.querySelector('[class*="sale"], [class*="discount"], [class*="special"], [class*="current"], strong');

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
