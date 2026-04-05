'use strict';

const fetch = require('node-fetch');
const { tag } = require('../tagger');

const STORE_NAME = 'Adidas';
const STORE_KEY = 'adidas';
const CURRENCY = 'CAD';
const SALE_URL = 'https://www.adidas.ca/en/sale';

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('Adidas: trying plp API…');

  // Adidas has a public PLP (product listing page) content engine API
  try {
    const deals = await scrapeViaAPI(onProgress);
    if (deals.length > 0) {
      onProgress(`Adidas: found ${deals.length} deals via API`);
      return deals;
    }
  } catch (err) {
    onProgress(`Adidas: API failed (${err.message}), switching to browser…`);
  }

  return scrapeViaBrowser(browser, onProgress);
}

async function scrapeViaAPI(onProgress) {
  const allDeals = [];
  let start = 0;
  const count = 48;

  while (true) {
    // Adidas CA's content engine API — publicly accessible
    const url = `https://www.adidas.ca/api/plp/content-engine?start=${start}&count=${count}&category=sale`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'en-CA,en;q=0.9',
        'Referer': 'https://www.adidas.ca/en/sale',
      },
      timeout: 15000,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const products = data?.plpState?.products || data?.items || [];
    if (products.length === 0) break;

    for (const p of products) {
      const deal = mapAdidasProduct(p);
      if (deal) allDeals.push(deal);
    }

    if (products.length < count) break;
    start += count;
    onProgress(`Adidas: fetched ${allDeals.length} deals from API…`);
  }

  return allDeals;
}

function mapAdidasProduct(p) {
  try {
    const name = p.displayName || p.name || '';
    if (!name) return null;

    const price = parseFloat(p.price?.sale ?? p.price?.standard ?? p.salePrice ?? p.price ?? 0);
    const originalPrice = parseFloat(p.price?.standard ?? p.originalPrice ?? p.price ?? 0);

    if (!price || !originalPrice || price >= originalPrice) return null;
    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const id = p.productId || p.id || '';
    const url = p.link || `https://www.adidas.ca/en/${slugify(name)}-${id}.html`;
    const image = p.image?.src || p.image?.url || p.images?.[0] || '';

    // Gender from category
    const division = (p.division || p.genderCategory || '').toLowerCase();
    const gender = division.includes('women') ? 'Women' : division.includes('men') ? 'Men' : '';

    return {
      id: slugify(`adidas-${name}-${id}`),
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

async function scrapeViaBrowser(browser, onProgress) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-CA',
    extraHTTPHeaders: {
      'Accept-Language': 'en-CA,en;q=0.9',
      'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    },
  });
  const page = await context.newPage();

  const rawProducts = [];
  const seenIds = new Set();

  page.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;
    if (!url.includes('adidas')) return;

    try {
      const json = await response.json();
      // Look for plpState.products in various response shapes
      const items = json?.plpState?.products || json?.itemList?.items || json?.items || json?.products || [];
      for (const p of items) {
        const id = p.productId || p.id || p.modelId || Math.random();
        if (!seenIds.has(id)) { seenIds.add(id); rawProducts.push(p); }
      }
    } catch (_) {}
  });

  try {
    // Try multiple sale URLs
    const urls = [
      SALE_URL,
      'https://www.adidas.ca/en/mens-sale',
      'https://www.adidas.ca/en/womens-sale',
    ];

    for (const url of urls) {
      onProgress(`Adidas: trying ${url}…`);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });

        try {
          await page.click('#onetrust-accept-btn-handler, button[class*="accept"]', { timeout: 4000 });
        } catch (_) {}

        await page.waitForTimeout(3000);

        // Click "Show More" until exhausted
        let round = 0;
        while (round < 25) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(1500);
          try {
            const btn = await page.$('button[data-auto-id="plp-show-more-button"], [class*="show-more"], [class*="ShowMore"]');
            if (!btn || !(await btn.isVisible())) break;
            await btn.click();
            round++;
            onProgress(`Adidas: loading more (batch ${round + 1})…`);
            await page.waitForTimeout(2000);
          } catch (_) { break; }
        }

        if (rawProducts.length > 0) break;
      } catch (err) {
        onProgress(`Adidas: ${url} failed — ${err.message}`);
      }
    }

    if (rawProducts.length > 0) {
      const deals = rawProducts.map(p => mapAdidasProduct(p)).filter(Boolean);
      onProgress(`Adidas: found ${deals.length} deals (XHR)`);
      return deals;
    }

    // DOM fallback
    const deals = await page.evaluate(({ storeName, storeKey }) => {
      const cards = [
        ...document.querySelectorAll('[data-auto-id="product-card"]'),
        ...document.querySelectorAll('[class*="product-card"]'),
        ...document.querySelectorAll('div[class*="grid-item"]'),
      ];
      const parsePrice = el => el ? parseFloat(el.textContent.replace(/[^0-9.]/g, '')) : null;
      const seen = new Set();
      return cards.map(card => {
        const link = card.querySelector('a[href]');
        const url = link?.href || '';
        if (!url || seen.has(url)) return null;
        seen.add(url);
        const nameEl = card.querySelector('[class*="name"], [data-auto-id="glass-hanger-title"], h2, h3, [class*="title"]');
        const salePriceEl = card.querySelector('[class*="sale-price"], [aria-label*="sale"], [class*="SalePrice"], [class*="gl-price-item--sale"]');
        const origPriceEl = card.querySelector('[class*="original"], s, del, [class*="strikethrough"]');
        const imgEl = card.querySelector('img[src]');
        const name = nameEl?.textContent?.trim() || '';
        const price = parsePrice(salePriceEl);
        const originalPrice = parsePrice(origPriceEl);
        if (!name || !url || !price || !originalPrice || price >= originalPrice) return null;
        const discount = Math.round((1 - price / originalPrice) * 100);
        if (discount <= 0) return null;
        return { store: storeName, storeKey, name, url, image: imgEl?.src || '', price, originalPrice, discount, currency: 'CAD', tags: [] };
      }).filter(Boolean);
    }, { storeName: STORE_NAME, storeKey: STORE_KEY });

    const tagged = deals.map(d => ({
      ...d,
      id: slugify(`adidas-${d.name}`),
      priceCAD: d.price,
      originalPriceCAD: d.originalPrice,
      tags: tag({ name: d.name }),
      scrapedAt: new Date().toISOString(),
    }));
    onProgress(`Adidas: found ${tagged.length} deals (DOM)`);
    return tagged;

  } finally {
    await context.close();
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
