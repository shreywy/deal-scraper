'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let allDeals = [];
let filteredDeals = [];
let cols = 4;
let currentSort = 'discount';
let config = null;

// Tile min-widths for each size step — auto-fill handles actual column count
const TILE_WIDTHS = { 1: 480, 2: 360, 3: 280, 4: 220, 5: 175, 6: 150, 7: 125, 8: 100 };
const SIZE_LABELS = { 1: 'XL', 2: 'L', 3: 'M-L', 4: 'M', 5: 'M-S', 6: 'S', 7: 'XS', 8: 'XXS' };

const filters = {
  store: 'all',
  gender: 'all',
  category: 'all',
  price: 'all',
  discount: '0',
};

// Pagination
const PAGE_SIZE = 100;
let currentPage = 1;

// Strip state
let lastScrapedAt = null;
let lastDealCount = 0;
let stripLive = false;
let stripTimerInterval = null;
let refreshInProgress = false;

// Hover preview state
let hoverTimer1 = null;
let hoverTimer2 = null;
let hoverTarget = null;
let mousePos = { x: 0, y: 0 };

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  if (localStorage.getItem('darkMode') === 'true') {
    document.documentElement.classList.add('dark');
  }

  const savedCols = parseInt(localStorage.getItem('gridCols') || '4');
  if (savedCols >= 1 && savedCols <= 8) cols = savedCols;
  applyGridSize();

  // Track mouse for hover preview
  document.addEventListener('mousemove', e => {
    mousePos = { x: e.clientX, y: e.clientY };
    const spinner = document.getElementById('hoverSpinner');
    if (spinner.classList.contains('visible')) {
      spinner.style.left = e.clientX + 'px';
      spinner.style.top = e.clientY + 'px';
    }
  });
  setupHoverListeners();

  try {
    const res = await fetch('/api/config');
    config = await res.json();
    renderSettingsDrawer(config);
  } catch (_) {}

  showSkeletons(12);
  setStrip('loading', 'Loading…');

  try {
    const res = await fetch('/api/deals');
    if (res.status === 204) {
      clearGrid();
      setStrip('cached', 'No cache yet — scraping now…');
    } else {
      const data = await res.json();
      lastScrapedAt = data.scrapedAt;
      lastDealCount = data.deals?.length || 0;
      stripLive = false;
      updateStripText();
      startStripTimer();
      loadDeals(data.deals);
    }
  } catch (_) {
    clearGrid();
    setStrip('cached', 'Could not load cache — scraping now…');
  }

  startRefreshStream();
}

// ── Strip ─────────────────────────────────────────────────────────────────────
function setStrip(state, text) {
  const strip = document.getElementById('refreshStrip');
  strip.classList.remove('live', 'outdated');
  if (state === 'live') strip.classList.add('live');
  if (state === 'outdated') strip.classList.add('outdated');
  document.getElementById('stripText').textContent = text;
}

function updateStripText() {
  if (!lastScrapedAt) return;
  const ageMs = Date.now() - new Date(lastScrapedAt);
  const ageSecs = Math.floor(ageMs / 1000);
  const ageStr = ageSecs < 60 ? 'just now'
    : ageSecs < 3600 ? `${Math.floor(ageSecs / 60)}m ago`
    : ageSecs < 86400 ? `${Math.floor(ageSecs / 3600)}h ago`
    : `${Math.floor(ageSecs / 86400)}d ago`;

  const isOutdated = ageMs > 12 * 3600 * 1000; // >12h = outdated
  const prefix = refreshInProgress ? 'Cached' : (stripLive ? 'Up to date' : 'Cached');

  const strip = document.getElementById('refreshStrip');
  strip.classList.remove('live', 'outdated');
  if (stripLive && !isOutdated) strip.classList.add('live');
  if (isOutdated) strip.classList.add('outdated');

  const refreshing = refreshInProgress ? ' · Refreshing…' : '';
  document.getElementById('stripText').textContent =
    `${prefix} · ${lastDealCount} deals · ${ageStr}${refreshing}`;
}

function startStripTimer() {
  if (stripTimerInterval) clearInterval(stripTimerInterval);
  stripTimerInterval = setInterval(updateStripText, 30000); // every 30s
}

function manualRefresh() {
  if (refreshInProgress) return;
  // Close existing SSE and open a new one
  startRefreshStream();
}

// ── SSE Refresh Stream ────────────────────────────────────────────────────────
let currentSSE = null;

function startRefreshStream() {
  if (currentSSE) { currentSSE.close(); currentSSE = null; }
  refreshInProgress = true;
  if (lastScrapedAt) updateStripText();
  else setStrip('cached', 'Scraping…');

  const es = new EventSource('/api/refresh');
  currentSSE = es;

  es.addEventListener('progress', e => {
    const { message } = JSON.parse(e.data);
    if (!lastScrapedAt) setStrip('cached', message);
    else {
      document.getElementById('stripText').textContent =
        document.getElementById('stripText').textContent.replace(' · Refreshing…', '') + ' · Refreshing…';
    }
    // Show progress message briefly in strip
    document.getElementById('stripText').textContent = message;
  });

  es.addEventListener('complete', e => {
    const { count, scrapedAt } = JSON.parse(e.data);
    lastScrapedAt = scrapedAt;
    lastDealCount = count;
    stripLive = true;
    refreshInProgress = false;
    updateStripText();
    startStripTimer();
    fetch('/api/deals').then(r => r.json()).then(data => loadDeals(data.deals)).catch(() => {});
    es.close(); currentSSE = null;
  });

  es.addEventListener('error', e => {
    try {
      const { message } = JSON.parse(e.data);
      refreshInProgress = false;
      setStrip('outdated', `Scrape error: ${message}`);
    } catch (_) {}
    es.close(); currentSSE = null;
  });

  es.onerror = () => {
    refreshInProgress = false;
    if (lastScrapedAt) updateStripText();
    es.close(); currentSSE = null;
  };
}

// ── Data Loading ─────────────────────────────────────────────────────────────
function loadDeals(deals) {
  allDeals = deals || [];
  buildDynamicFilters();
  currentPage = 1;
  applyFiltersAndRender();
}

function buildDynamicFilters() {
  // Store pills
  const stores = [...new Set(allDeals.map(d => d.store))].sort();
  const storePills = document.getElementById('storePills');
  storePills.innerHTML = makePill('store', 'all', 'All', true);
  for (const s of stores) storePills.insertAdjacentHTML('beforeend', makePill('store', s, s));

  // Category pills
  const GENDER_TAGS = new Set(['Men', 'Women', 'Unisex', 'Kids']);
  const cats = [...new Set(allDeals.flatMap(d => d.tags).filter(t => !GENDER_TAGS.has(t)))].sort();
  const catPills = document.getElementById('categoryPills');
  catPills.innerHTML = makePill('category', 'all', 'All', true);
  for (const c of cats) catPills.insertAdjacentHTML('beforeend', makePill('category', c, c));

  // Dynamic price range pills — use CAD price for consistency
  const cadPrice = d => (d.currency === 'USD' && d.priceCAD) ? d.priceCAD : d.price;
  const PRICE_BREAKS = [25, 50, 100, 200, 500];
  const pricePills = document.getElementById('pricePills');
  pricePills.innerHTML = makePill('price', 'all', 'Any', true);
  let prev = 0;
  for (const bp of PRICE_BREAKS) {
    const count = allDeals.filter(d => cadPrice(d) > prev && cadPrice(d) <= bp).length;
    if (count > 0) {
      const label = prev === 0 ? `Under $${bp}` : `$${prev}–$${bp}`;
      pricePills.insertAdjacentHTML('beforeend', makePill('price', `${prev}-${bp}`, label));
    }
    prev = bp;
  }
  const above = allDeals.filter(d => cadPrice(d) > prev).length;
  if (above > 0) pricePills.insertAdjacentHTML('beforeend', makePill('price', `${prev}-99999`, `$${prev}+`));

  // Dynamic discount pills — only show thresholds where deals exist
  const DISC_STEPS = [10, 20, 30, 40, 50, 60, 70];
  const discPills = document.getElementById('discountPills');
  discPills.innerHTML = makePill('discount', '0', 'Any', true);
  for (const t of DISC_STEPS) {
    if (allDeals.some(d => d.discount >= t)) {
      discPills.insertAdjacentHTML('beforeend', makePill('discount', String(t), `${t}%+`));
    }
  }

  // Re-sync active states
  syncPillActive('store', filters.store);
  syncPillActive('category', filters.category);
  syncPillActive('price', filters.price);
  syncPillActive('discount', filters.discount);
}

function makePill(filter, value, label, active = false) {
  return `<div class="pill${active ? ' active' : ''}" data-filter="${filter}" data-value="${escHtml(value)}" onclick="togglePill(this)">${escHtml(label)}</div>`;
}

function syncPillActive(filter, value) {
  document.querySelectorAll(`[data-filter="${filter}"]`).forEach(p => {
    p.classList.toggle('active', p.dataset.value === value);
  });
}

// ── Filtering & Sorting ───────────────────────────────────────────────────────
function applyFiltersAndRender() {
  let deals = [...allDeals];

  if (filters.store !== 'all') deals = deals.filter(d => d.store === filters.store);
  if (filters.gender !== 'all') deals = deals.filter(d => d.tags.includes(filters.gender));
  if (filters.category !== 'all') deals = deals.filter(d => d.tags.includes(filters.category));
  if (filters.price !== 'all') {
    const [lo, hi] = filters.price.split('-').map(Number);
    // Use priceCAD for USD items so price filter works consistently in CAD
    deals = deals.filter(d => {
      const p = d.currency === 'USD' && d.priceCAD ? d.priceCAD : d.price;
      return p >= lo && p <= hi;
    });
  }
  const minDiscount = parseInt(filters.discount) || 0;
  if (minDiscount > 0) deals = deals.filter(d => d.discount >= minDiscount);

  deals.sort((a, b) => {
    if (currentSort === 'discount') return b.discount - a.discount;
    if (currentSort === 'price-asc') return a.price - b.price;
    if (currentSort === 'price-desc') return b.price - a.price;
    if (currentSort === 'newest') return new Date(b.scrapedAt) - new Date(a.scrapedAt);
    return 0;
  });

  filteredDeals = deals;
  currentPage = 1;
  renderGrid();
  renderResultsBar();
  renderPagination();
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderGrid() {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('emptyState');

  if (filteredDeals.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageDeals = filteredDeals.slice(start, start + PAGE_SIZE);

  grid.innerHTML = pageDeals.map((d, i) => {
    const isUSD = d.currency === 'USD';
    const displayPrice = isUSD && d.priceCAD ? d.priceCAD : d.price;
    const displayOrig = isUSD && d.originalPriceCAD ? d.originalPriceCAD : d.originalPrice;
    const priceLabel = isUSD
      ? `~$${displayPrice.toFixed(2)} <span class="price-cad-note">CAD</span>`
      : `$${displayPrice.toFixed(2)}`;
    const origLabel = isUSD
      ? `~$${displayOrig.toFixed(2)}`
      : `$${displayOrig.toFixed(2)}`;
    const usdNote = isUSD
      ? `<span class="usd-badge">USD $${d.price.toFixed(2)}</span>`
      : '';

    return `
    <a class="tile" href="${escHtml(d.url)}" target="_blank" rel="noopener"
       data-idx="${start + i}" style="animation-delay:${Math.min(i * 0.03, 0.3)}s">
      <div class="tile-img">
        ${d.image
          ? `<img src="${escHtml(d.image)}" alt="${escHtml(d.name)}" loading="lazy" onerror="this.parentNode.innerHTML='<span class=\\'img-fallback\\'>🛍️</span>'">`
          : `<span class="img-fallback">🛍️</span>`}
      </div>
      <div class="tile-body">
        <div class="tile-store">${escHtml(d.store)}${usdNote}</div>
        <div class="tile-name" title="${escHtml(d.name)}">${escHtml(d.name)}</div>
        <div class="tile-tags">${d.tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join('')}</div>
        <div class="tile-price-row">
          <span class="price-now">${priceLabel}</span>
          <span class="price-orig">${origLabel}</span>
          <span class="discount-badge">−${d.discount}%</span>
        </div>
      </div>
    </a>`;
  }).join('');
}

function renderResultsBar() {
  const total = filteredDeals.length;
  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, total);
  let text = `${total} deal${total !== 1 ? 's' : ''}`;
  if (allDeals.length !== total) text += ` of ${allDeals.length}`;
  if (total > PAGE_SIZE) text += ` · showing ${start}–${end}`;
  document.getElementById('resultsCount').textContent = text;

  const chips = [];
  for (const [key, val] of Object.entries(filters)) {
    if (val === 'all' || val === '0') continue;
    const label = key === 'price' ? `$${val.replace(/-99999$/, '+').replace('-', '–')}` : key === 'discount' ? `${val}%+` : val;
    chips.push(`<div class="active-tag">${escHtml(label)} <span class="active-tag-x" onclick="clearFilter('${key}')">×</span></div>`);
  }
  document.getElementById('activeFilters').innerHTML = chips.join('');
}

function renderPagination() {
  const total = filteredDeals.length;
  const pageCount = Math.ceil(total / PAGE_SIZE);
  const pg = document.getElementById('pagination');

  if (pageCount <= 1) { pg.innerHTML = ''; return; }

  const prevDis = currentPage === 1 ? ' disabled' : '';
  const nextDis = currentPage === pageCount ? ' disabled' : '';
  let html = `<button class="pg-btn"${prevDis} onclick="goPage(${currentPage - 1})">← Prev</button>`;
  html += `<span class="pg-info">Page ${currentPage} of ${pageCount}</span>`;

  // Up to 5 page number buttons around current page
  const lo = Math.max(1, currentPage - 2);
  const hi = Math.min(pageCount, currentPage + 2);
  if (lo > 1) html += `<button class="pg-btn" onclick="goPage(1)">1</button>${lo > 2 ? '<span class="pg-info">…</span>' : ''}`;
  for (let p = lo; p <= hi; p++) {
    html += `<button class="pg-btn${p === currentPage ? ' active' : ''}" onclick="goPage(${p})">${p}</button>`;
  }
  if (hi < pageCount) html += `${hi < pageCount - 1 ? '<span class="pg-info">…</span>' : ''}<button class="pg-btn" onclick="goPage(${pageCount})">${pageCount}</button>`;

  html += `<button class="pg-btn"${nextDis} onclick="goPage(${currentPage + 1})">Next →</button>`;
  pg.innerHTML = html;
}

function goPage(p) {
  currentPage = p;
  renderGrid();
  renderResultsBar();
  renderPagination();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showSkeletons(n) {
  const grid = document.getElementById('grid');
  grid.innerHTML = Array.from({ length: n }, () => `
    <div class="tile tile-skel">
      <div class="tile-img skel-img skeleton"></div>
      <div class="tile-body">
        <div class="skel-line skeleton med"></div>
        <div class="skel-line skeleton short" style="margin-top:4px"></div>
        <div class="skel-line skeleton price"></div>
      </div>
    </div>
  `).join('');
}

function clearGrid() { document.getElementById('grid').innerHTML = ''; }

// ── Hover Preview ─────────────────────────────────────────────────────────────
function setupHoverListeners() {
  const grid = document.getElementById('grid');

  grid.addEventListener('mouseover', e => {
    const tile = e.target.closest('[data-idx]');
    if (!tile) return;
    if (hoverTarget?.tile === tile) return;
    cancelHover();
    const idx = parseInt(tile.dataset.idx);
    if (!isNaN(idx) && filteredDeals[idx]) {
      hoverTarget = { tile, deal: filteredDeals[idx] };
      hoverTimer1 = setTimeout(() => startSpinner(tile, filteredDeals[idx]), 2000);
    }
  });

  grid.addEventListener('mouseout', e => {
    const tile = e.target.closest('[data-idx]');
    if (!tile) return;
    if (tile.contains(e.relatedTarget)) return;
    cancelHover();
  });
}

function startSpinner(tile, deal) {
  const spinner = document.getElementById('hoverSpinner');
  spinner.style.left = mousePos.x + 'px';
  spinner.style.top = mousePos.y + 'px';
  spinner.classList.add('visible');
  // Force reflow so transition starts from dashoffset=106.8
  spinner.classList.remove('animating');
  void spinner.offsetWidth;
  requestAnimationFrame(() => spinner.classList.add('animating'));

  hoverTimer2 = setTimeout(() => {
    spinner.classList.remove('visible', 'animating');
    showPreviewCard(deal, tile);
  }, 3000);
}

function cancelHover() {
  clearTimeout(hoverTimer1);
  clearTimeout(hoverTimer2);
  hoverTimer1 = hoverTimer2 = null;
  hoverTarget = null;
  const spinner = document.getElementById('hoverSpinner');
  spinner.classList.remove('visible', 'animating');
  hidePreviewCard();
}

function showPreviewCard(deal, tile) {
  const card = document.getElementById('previewCard');
  const isUSD = deal.currency === 'USD';
  const dp = isUSD && deal.priceCAD ? deal.priceCAD : deal.price;
  const do_ = isUSD && deal.originalPriceCAD ? deal.originalPriceCAD : deal.originalPrice;

  card.innerHTML = `
    <div class="pc-img">
      ${deal.image
        ? `<img src="${escHtml(deal.image)}" alt="${escHtml(deal.name)}" onerror="this.parentNode.innerHTML='<span class=pc-fallback>🛍️</span>'">`
        : `<span class="pc-fallback">🛍️</span>`}
    </div>
    <div class="pc-body">
      <div class="pc-store">${escHtml(deal.store)}${isUSD ? ' <span class="usd-badge">USD</span>' : ''}</div>
      <div class="pc-name">${escHtml(deal.name)}</div>
      <div class="pc-tags">${deal.tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join('')}</div>
      <div class="pc-price-row">
        <span class="price-now">${isUSD ? `~$${dp.toFixed(2)} CAD` : `$${dp.toFixed(2)}`}</span>
        <span class="price-orig">${isUSD ? `~$${do_.toFixed(2)}` : `$${do_.toFixed(2)}`}</span>
        <span class="discount-badge">−${deal.discount}%</span>
      </div>
      ${isUSD ? `<div class="pc-usd-note">USD: $${deal.price.toFixed(2)} → $${dp.toFixed(2)} CAD${deal.exchangeRate ? ` @ ${deal.exchangeRate.toFixed(4)}` : ''}</div>` : ''}
      <div class="pc-hint">Click tile to open →</div>
    </div>
  `;

  const rect = tile.getBoundingClientRect();
  const cardW = 270;
  const cardH = 380;
  const margin = 10;

  let left = rect.right + margin;
  let top = rect.top;
  if (left + cardW > window.innerWidth - margin) left = rect.left - cardW - margin;
  left = Math.max(margin, Math.min(left, window.innerWidth - cardW - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - cardH - margin));

  card.style.left = left + 'px';
  card.style.top = top + 'px';
  card.classList.add('visible');
}

function hidePreviewCard() {
  document.getElementById('previewCard').classList.remove('visible');
}

// ── Settings Drawer ───────────────────────────────────────────────────────────
async function renderSettingsDrawer(cfg) {
  const body = document.getElementById('drawerBody');
  const stores = cfg.stores || {};
  const settings = cfg.settings || {};

  // Fetch last scrape status for per-store counts
  let status = {};
  try {
    const r = await fetch('/api/status');
    status = await r.json();
  } catch (_) {}

  const storeRows = Object.entries(stores).map(([key, s]) => {
    const sr = status.storeResults?.[key];
    const statusText = sr
      ? (sr.error ? `⚠ ${sr.error.slice(0, 40)}` : `${sr.count} deals`)
      : 'not scraped yet';
    const dotClass = sr ? (sr.error ? 'warn' : 'ok') : '';
    return `
    <div class="ds-row">
      <div class="ds-row-text">
        <div class="ds-name">${escHtml(s.name)}</div>
        <div class="ds-sub"><span class="store-status"><span class="status-dot ${dotClass}"></span>${escHtml(statusText)}</span></div>
      </div>
      <div class="toggle ${s.enabled ? 'on' : ''}" onclick="toggleStore('${key}', this)"></div>
    </div>`;
  }).join('');

  body.innerHTML = `
    <div class="ds-section">
      <div class="ds-label">Active Stores</div>
      ${storeRows}
    </div>
    <div class="ds-section">
      <div class="ds-label">Behaviour</div>
      <div class="ds-row">
        <div class="ds-row-text">
          <div class="ds-name">Auto-refresh on launch</div>
          <div class="ds-sub">Scrape all enabled stores on startup</div>
        </div>
        <div class="toggle ${settings.autoRefreshOnLaunch !== false ? 'on' : ''}" onclick="toggleSetting('autoRefreshOnLaunch', this)"></div>
      </div>
      <div class="ds-row">
        <div class="ds-row-text">
          <div class="ds-name">Show % off badges</div>
          <div class="ds-sub">Display discount percentage on tiles</div>
        </div>
        <div class="toggle ${settings.showDiscountBadges !== false ? 'on' : ''}" onclick="toggleSetting('showDiscountBadges', this)"></div>
      </div>
      <div class="ds-row">
        <div class="ds-row-text">
          <div class="ds-name">Auto-convert USD to CAD</div>
          <div class="ds-sub">Show ~CAD price for USD stores${status.usdToCAD ? ` · Rate: 1 USD = ${status.usdToCAD.toFixed(4)} CAD` : ''}</div>
        </div>
        <div class="toggle ${settings.autoCurrencyConvert !== false ? 'on' : ''}" onclick="toggleSetting('autoCurrencyConvert', this)"></div>
      </div>
    </div>
    <div class="ds-section">
      <div class="ds-label">Global Filters</div>
      <div class="ds-row">
        <div class="ds-row-text">
          <div class="ds-name">Min. discount threshold</div>
          <div class="ds-sub">Hide items below this % off (applied at scrape time)</div>
        </div>
        <div class="stepper">
          <div class="stepper-btn" onclick="stepSetting('minDiscountPercent', -10)">−</div>
          <div class="stepper-val" id="discountStepVal">${settings.minDiscountPercent || 0}%</div>
          <div class="stepper-btn" onclick="stepSetting('minDiscountPercent', 10)">+</div>
        </div>
      </div>
    </div>
    <div class="ds-section">
      <div class="ds-label">Scheduling</div>
      <div class="ds-row">
        <div class="ds-row-text">
          <div class="ds-name">Auto-scrape interval</div>
          <div class="ds-sub">Automatically refresh deals while app is running</div>
        </div>
        <div class="stepper">
          <div class="stepper-btn" onclick="stepSetting('refreshIntervalHours', -1)">−</div>
          <div class="stepper-val" id="intervalStepVal" style="min-width:48px">${settings.refreshIntervalHours || 6}h</div>
          <div class="stepper-btn" onclick="stepSetting('refreshIntervalHours', 1)">+</div>
        </div>
      </div>
    </div>
  `;
}

async function toggleStore(key, el) {
  el.classList.toggle('on');
  const enabled = el.classList.contains('on');
  await patchConfig({ stores: { [key]: { enabled } } });
  if (config?.stores?.[key]) config.stores[key].enabled = enabled;
}

async function toggleSetting(key, el) {
  el.classList.toggle('on');
  const value = el.classList.contains('on');
  await patchConfig({ settings: { [key]: value } });
  if (config?.settings) config.settings[key] = value;
}

async function stepSetting(key, delta) {
  if (!config) return;
  const current = config.settings?.[key] ?? 0;
  let next;
  if (key === 'minDiscountPercent') {
    next = Math.max(0, Math.min(70, current + delta));
    const el = document.getElementById('discountStepVal');
    if (el) el.textContent = `${next}%`;
  } else if (key === 'refreshIntervalHours') {
    next = Math.max(1, Math.min(168, current + delta));
    const el = document.getElementById('intervalStepVal');
    if (el) el.textContent = `${next}h`;
  } else {
    next = current + delta;
  }
  config.settings[key] = next;
  await patchConfig({ settings: { [key]: next } });
}

async function patchConfig(patch) {
  try {
    await fetch('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  } catch (_) {}
}

// ── Controls ─────────────────────────────────────────────────────────────────
function changeGrid(d) {
  cols = Math.max(1, Math.min(8, cols + d));
  applyGridSize();
  localStorage.setItem('gridCols', cols);
}

function applyGridSize() {
  const minW = TILE_WIDTHS[cols] || 220;
  document.getElementById('grid').style.setProperty('--tile-min', `${minW}px`);
  document.getElementById('gsVal').textContent = cols;
  document.getElementById('gridLabel').textContent = SIZE_LABELS[cols] || cols;
}

function setSort(el) {
  document.querySelectorAll('.sort-row').forEach(r => r.classList.remove('active'));
  el.classList.add('active');
  currentSort = el.dataset.sort;
  currentPage = 1;
  applyFiltersAndRender();
}

function togglePill(el) {
  const group = el.closest('.pill-group');
  const filterKey = el.dataset.filter;
  const value = el.dataset.value;

  group.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));

  if (value === 'all' || value === '0') {
    el.classList.add('active');
    filters[filterKey] = filterKey === 'discount' ? '0' : 'all';
  } else {
    // Also deactivate the "all" pill
    const allPill = group.querySelector('[data-value="all"], [data-value="0"]');
    if (allPill) allPill.classList.remove('active');
    el.classList.add('active');
    filters[filterKey] = value;
  }
  currentPage = 1;
  applyFiltersAndRender();
}

function clearFilter(key) {
  filters[key] = key === 'discount' ? '0' : 'all';
  syncPillActive(key, filters[key]);
  currentPage = 1;
  applyFiltersAndRender();
}

// ── Drawer ────────────────────────────────────────────────────────────────────
function toggleDrawer() {
  document.getElementById('drawer').classList.contains('open') ? closeDrawer() : openDrawer();
}
function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('overlay').classList.add('open');
  document.getElementById('menuBtn').classList.add('open');
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
  document.getElementById('menuBtn').classList.remove('open');
}

// ── Dark mode ─────────────────────────────────────────────────────────────────
function toggleDark() {
  document.documentElement.classList.toggle('dark');
  localStorage.setItem('darkMode', document.documentElement.classList.contains('dark'));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
