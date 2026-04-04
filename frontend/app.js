'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let allDeals = [];
let filteredDeals = [];
let cols = 4;   // 1–8 scale; maps to tile min-widths (smaller col = smaller tiles = more per row)
let currentSort = 'discount';

// Tile min-widths for each "cols" step — auto-fill handles actual column count
const TILE_WIDTHS = { 1: 480, 2: 360, 3: 280, 4: 220, 5: 175, 6: 150, 7: 125, 8: 100 };
let config = null;

const filters = {
  store: 'all',
  gender: 'all',
  category: 'all',
  price: 'all',
  discount: '0',
};

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  // Restore dark mode preference
  if (localStorage.getItem('darkMode') === 'true') {
    document.documentElement.classList.add('dark');
  }

  // Restore grid size preference
  const savedCols = parseInt(localStorage.getItem('gridCols') || '4');
  if (savedCols >= 1 && savedCols <= 8) {
    cols = savedCols;
  }
  applyGridSize();

  // Load config first (for settings drawer)
  try {
    const res = await fetch('/api/config');
    config = await res.json();
    renderSettingsDrawer(config);
  } catch (_) {}

  // Load cached deals immediately
  showSkeletons(9);
  setStrip('cached', 'Loading cached deals…');

  try {
    const res = await fetch('/api/deals');
    if (res.status === 204) {
      setStrip('cached', 'No cache yet — scraping now…');
      clearGrid();
    } else {
      const data = await res.json();
      const age = data.scrapedAt ? timeSince(data.scrapedAt) : 'unknown';
      setStrip('cached', `Cached results from ${age} ago · Refreshing…`);
      loadDeals(data.deals);
    }
  } catch (_) {
    setStrip('cached', 'Could not load cache — scraping now…');
    clearGrid();
  }

  // Kick off background refresh via SSE
  startRefreshStream();
}

// ── SSE Refresh Stream ────────────────────────────────────────────────────────
function startRefreshStream() {
  const es = new EventSource('/api/refresh');

  es.addEventListener('progress', e => {
    const { message } = JSON.parse(e.data);
    setStrip('cached', message);
  });

  es.addEventListener('complete', e => {
    const { count, scrapedAt } = JSON.parse(e.data);
    setStrip('live', `Up to date · ${count} deals · refreshed just now`);
    // Re-fetch the now-updated cache
    fetch('/api/deals')
      .then(r => r.json())
      .then(data => loadDeals(data.deals))
      .catch(() => {});
    es.close();
  });

  es.addEventListener('error', e => {
    try {
      const { message } = JSON.parse(e.data);
      setStrip('cached', `Scrape error: ${message}`);
    } catch (_) {}
    es.close();
  });

  es.onerror = () => es.close();
}

// ── Data Loading ─────────────────────────────────────────────────────────────
function loadDeals(deals) {
  allDeals = deals || [];
  buildDynamicFilters();
  applyFiltersAndRender();
}

function buildDynamicFilters() {
  // Store pills
  const stores = [...new Set(allDeals.map(d => d.store))].sort();
  const storePills = document.getElementById('storePills');
  storePills.innerHTML = `<div class="pill active" data-filter="store" data-value="all" onclick="togglePill(this)">All</div>`;
  for (const s of stores) {
    const pill = document.createElement('div');
    pill.className = 'pill';
    pill.dataset.filter = 'store';
    pill.dataset.value = s;
    pill.textContent = s;
    pill.onclick = () => togglePill(pill);
    storePills.appendChild(pill);
  }

  // Category pills — collect all unique tags that aren't gender tags
  const GENDER_TAGS = new Set(['Men', 'Women', 'Unisex', 'Kids']);
  const categories = [...new Set(allDeals.flatMap(d => d.tags).filter(t => !GENDER_TAGS.has(t)))].sort();
  const catPills = document.getElementById('categoryPills');
  catPills.innerHTML = `<div class="pill active" data-filter="category" data-value="all" onclick="togglePill(this)">All</div>`;
  for (const c of categories) {
    const pill = document.createElement('div');
    pill.className = 'pill';
    pill.dataset.filter = 'category';
    pill.dataset.value = c;
    pill.textContent = c;
    pill.onclick = () => togglePill(pill);
    catPills.appendChild(pill);
  }

  // Re-sync active filter state for store/category pills
  if (filters.store !== 'all') {
    const p = storePills.querySelector(`[data-value="${filters.store}"]`);
    if (p) { storePills.querySelector('[data-value="all"]').classList.remove('active'); p.classList.add('active'); }
  }
  if (filters.category !== 'all') {
    const p = catPills.querySelector(`[data-value="${filters.category}"]`);
    if (p) { catPills.querySelector('[data-value="all"]').classList.remove('active'); p.classList.add('active'); }
  }
}

// ── Filtering & Sorting ───────────────────────────────────────────────────────
function applyFiltersAndRender() {
  let deals = [...allDeals];

  // Store
  if (filters.store !== 'all') {
    deals = deals.filter(d => d.store === filters.store);
  }

  // Gender
  if (filters.gender !== 'all') {
    deals = deals.filter(d => d.tags.includes(filters.gender));
  }

  // Category
  if (filters.category !== 'all') {
    deals = deals.filter(d => d.tags.includes(filters.category));
  }

  // Price
  if (filters.price !== 'all') {
    const [lo, hi] = filters.price.split('-').map(Number);
    deals = deals.filter(d => d.price >= lo && d.price <= hi);
  }

  // Min discount
  const minDiscount = parseInt(filters.discount) || 0;
  if (minDiscount > 0) {
    deals = deals.filter(d => d.discount >= minDiscount);
  }

  // Sort
  deals.sort((a, b) => {
    if (currentSort === 'discount') return b.discount - a.discount;
    if (currentSort === 'price-asc') return a.price - b.price;
    if (currentSort === 'price-desc') return b.price - a.price;
    if (currentSort === 'newest') return new Date(b.scrapedAt) - new Date(a.scrapedAt);
    return 0;
  });

  filteredDeals = deals;
  renderGrid();
  renderResultsBar();
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

  grid.innerHTML = filteredDeals.map((d, i) => `
    <a class="tile" href="${escHtml(d.url)}" target="_blank" rel="noopener" style="animation-delay:${Math.min(i * 0.04, 0.4)}s">
      <div class="tile-img">
        ${d.image
          ? `<img src="${escHtml(d.image)}" alt="${escHtml(d.name)}" loading="lazy" onerror="this.parentNode.innerHTML='<span class=\\'img-fallback\\'>🛍️</span>'">`
          : `<span class="img-fallback">🛍️</span>`}
      </div>
      <div class="tile-body">
        <div class="tile-store">${escHtml(d.store)}</div>
        <div class="tile-name" title="${escHtml(d.name)}">${escHtml(d.name)}</div>
        <div class="tile-tags">${d.tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join('')}</div>
        <div class="tile-price-row">
          <span class="price-now">$${d.price.toFixed(2)}</span>
          <span class="price-orig">$${d.originalPrice.toFixed(2)}</span>
          <span class="discount-badge">−${d.discount}%</span>
        </div>
      </div>
    </a>
  `).join('');
}

function renderResultsBar() {
  document.getElementById('resultsCount').textContent =
    `${filteredDeals.length} deal${filteredDeals.length !== 1 ? 's' : ''}${allDeals.length !== filteredDeals.length ? ` of ${allDeals.length}` : ''}`;

  const activeContainer = document.getElementById('activeFilters');
  const chips = [];
  for (const [key, val] of Object.entries(filters)) {
    if (val === 'all' || val === '0') continue;
    const label = key === 'price' ? `$${val.replace('-', '–')}` : key === 'discount' ? `${val}%+` : val;
    chips.push(`<div class="active-tag">${escHtml(label)} <span class="active-tag-x" onclick="clearFilter('${key}')">×</span></div>`);
  }
  activeContainer.innerHTML = chips.join('');
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

function clearGrid() {
  document.getElementById('grid').innerHTML = '';
}

// ── Settings Drawer ───────────────────────────────────────────────────────────
function renderSettingsDrawer(cfg) {
  const body = document.getElementById('drawerBody');
  const stores = cfg.stores || {};
  const settings = cfg.settings || {};

  const storeRows = Object.entries(stores).map(([key, s]) => `
    <div class="ds-row">
      <div class="ds-row-text">
        <div class="ds-name">${escHtml(s.name)}</div>
        <div class="ds-sub"><span class="store-status"><span class="status-dot ok"></span>${escHtml(s.domain)}</span></div>
      </div>
      <div class="toggle ${s.enabled ? 'on' : ''}" onclick="toggleStore('${key}', this)"></div>
    </div>
  `).join('');

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
    config.settings[key] = next;
    const el = document.getElementById('discountStepVal');
    if (el) el.textContent = `${next}%`;
  } else if (key === 'refreshIntervalHours') {
    next = Math.max(1, Math.min(168, current + delta)); // 1h to 1 week
    config.settings[key] = next;
    const el = document.getElementById('intervalStepVal');
    if (el) el.textContent = `${next}h`;
  } else {
    next = current + delta;
    config.settings[key] = next;
  }
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
  const grid = document.getElementById('grid');
  const minW = TILE_WIDTHS[cols] || 220;
  grid.style.setProperty('--tile-min', `${minW}px`);
  document.getElementById('gsVal').textContent = cols;
  // Label reflects what this size means visually
  const labels = { 1: 'XL', 2: 'L', 3: 'M-L', 4: 'M', 5: 'M-S', 6: 'S', 7: 'XS', 8: 'XXS' };
  document.getElementById('gridLabel').textContent = `Tile size: ${labels[cols] || cols}`;
}

function setSort(el) {
  document.querySelectorAll('.sort-row').forEach(r => r.classList.remove('active'));
  el.classList.add('active');
  currentSort = el.dataset.sort;
  applyFiltersAndRender();
}

function togglePill(el) {
  const group = el.closest('.pill-group');
  const filterKey = el.dataset.filter;
  const value = el.dataset.value;

  if (value === 'all' || value === 'Any') {
    group.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    filters[filterKey] = 'all';
  } else {
    const allPill = group.querySelector('[data-value="all"], [data-value="Any"]');
    if (allPill) allPill.classList.remove('active');
    el.classList.toggle('active');
    // Single-select for most filters
    group.querySelectorAll('.pill').forEach(p => {
      if (p !== el && p !== allPill) p.classList.remove('active');
    });
    el.classList.add('active');
    filters[filterKey] = value;
  }
  applyFiltersAndRender();
}

function clearFilter(key) {
  filters[key] = key === 'discount' ? '0' : 'all';
  // Reset corresponding pill group
  document.querySelectorAll(`[data-filter="${key}"]`).forEach(p => {
    const val = p.dataset.value;
    const isDefault = val === 'all' || val === 'Any' || val === '0';
    p.classList.toggle('active', isDefault);
  });
  applyFiltersAndRender();
}

// ── Drawer ────────────────────────────────────────────────────────────────────
function toggleDrawer() {
  const isOpen = document.getElementById('drawer').classList.contains('open');
  isOpen ? closeDrawer() : openDrawer();
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

// ── Refresh strip ─────────────────────────────────────────────────────────────
function setStrip(state, text) {
  const strip = document.getElementById('refreshStrip');
  strip.classList.toggle('live', state === 'live');
  document.getElementById('stripText').textContent = text;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function timeSince(iso) {
  const secs = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
