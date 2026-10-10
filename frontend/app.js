'use strict';

// dealsco frontend. Runs against the local Express server (live refresh over SSE) or as a
// static site (GitHub Pages) that reads the deals.json / config.json published next to it.

const GENDERS = ['Men', 'Women', 'Kids', 'Unisex'];
const PAGE_SIZE = 60;
const STALE_HOURS = 36;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + (Number.isInteger(n) ? n : n.toFixed(2));
const saved = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch (_) { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
};
const ICON_X = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const ICON_CHEV = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

// ── State ─────────────────────────────────────────────────────────────────────
let STATIC = false;
let config = { stores: {} };
let meta = { scrapedAt: null, storeResults: {} };
let deals = [];
let results = [];
let shown = PAGE_SIZE;
let live = null; // { progress: {key: {name,status,count,error}} } while a local scrape runs

const blankFilters = () => ({ cats: [], stores: [], xcats: [], xstores: [], min: '', max: '', off: 0 });
const ui = {
  dept: saved.get('dept', 'Men'),
  sort: saved.get('sort', 'discount'),
  q: '',
  storeQ: '',
  allStores: false,
  closed: saved.get('closedGroups', []),
  f: blankFilters(),
};
const loadFilters = () => { ui.f = { ...blankFilters(), ...saved.get('filters:' + ui.dept, {}) }; };
const saveFilters = () => saved.set('filters:' + ui.dept, ui.f);

// ── Deal helpers ──────────────────────────────────────────────────────────────
// USD stores carry a CAD estimate; everything is shown and compared in CAD
const priceOf = d => (d.currency === 'USD' && d.priceCAD ? d.priceCAD : d.price);
const wasOf = d => (d.currency === 'USD' && d.originalPriceCAD ? d.originalPriceCAD : d.originalPrice);

function prepare(list) {
  for (const d of list) {
    d._home = d.tags.includes('Non-Clothing');
    d._cats = d.tags.filter(t => !GENDERS.includes(t) && t !== 'Non-Clothing');
    d._text = (d.name + ' ' + d.store).toLowerCase();
    d._p = priceOf(d);
  }
  return list;
}

// Men/Women include unisex items; untagged items only show under Everyone, so Men never shows women's stock
function inDept(d) {
  if (ui.dept === 'Home') return d._home;
  if (d._home) return false;
  if (ui.dept === 'All') return true;
  return d.tags.includes(ui.dept) || ((ui.dept === 'Men' || ui.dept === 'Women') && d.tags.includes('Unisex'));
}

// skip: leave one facet out, so each facet's counts reflect every *other* active filter
function passes(d, words, skip) {
  const f = ui.f;
  if (!inDept(d)) return false;
  if (words.length && !words.every(w => d._text.includes(w))) return false;
  if (skip !== 'cat') {
    if (f.cats.length && !d._cats.some(c => f.cats.includes(c))) return false;
    if (f.xcats.length && d._cats.some(c => f.xcats.includes(c))) return false;
  }
  if (skip !== 'store') {
    if (f.stores.length && !f.stores.includes(d.storeKey)) return false;
    if (f.xstores.includes(d.storeKey)) return false;
  }
  if (f.min !== '' && d._p < +f.min) return false;
  if (f.max !== '' && d._p > +f.max) return false;
  if (skip !== 'off' && d.discount < f.off) return false;
  return true;
}

const SORTS = {
  discount: (a, b) => b.discount - a.discount,
  low: (a, b) => a._p - b._p,
  high: (a, b) => b._p - a._p,
  saved: (a, b) => (wasOf(b) - b._p) - (wasOf(a) - a._p),
};

// ── Rendering ─────────────────────────────────────────────────────────────────
const searchWords = () => ui.q.toLowerCase().split(/\s+/).filter(Boolean);

function render() {
  const words = searchWords();
  results = deals.filter(d => passes(d, words)).sort(SORTS[ui.sort]);
  shown = PAGE_SIZE;
  renderToolbar();
  renderGrid();
  renderFilters(words);
  document.querySelectorAll('.dept').forEach(b => b.setAttribute('aria-selected', b.dataset.dept === ui.dept));
}

const storeNames = new Map();
function storeName(key) {
  return config.stores[key]?.name || storeNames.get(key) || key;
}

function renderToolbar() {
  const f = ui.f;
  $('count').innerHTML = `${results.length.toLocaleString()} <span>${results.length === 1 ? 'result' : 'results'}</span>`;
  const chips = [
    ...f.cats.map(v => ['cats', v, v]),
    ...f.xcats.map(v => ['xcats', v, v]),
    ...f.stores.map(v => ['stores', v, storeName(v)]),
    ...f.xstores.map(v => ['xstores', v, storeName(v)]),
    ...(f.off ? [['off', '', `${f.off}%+ off`]] : []),
    ...(f.min !== '' || f.max !== '' ? [['price', '', `${f.min ? '$' + f.min : '$0'} – ${f.max ? '$' + f.max : 'any'}`]] : []),
  ];
  $('chips').innerHTML = chips.map(([k, v, label]) =>
    `<button class="chip${k[0] === 'x' ? ' x' : ''}" data-chip="${k}" data-v="${esc(v)}" aria-label="Remove ${k[0] === 'x' ? 'exclusion ' : ''}${esc(label)}">${esc(label)}${ICON_X}</button>`
  ).join('') + (chips.length > 1 ? '<button class="clear" data-clearall>Clear all</button>' : '');
  $('fcount').textContent = chips.length ? ` · ${chips.length}` : '';
  $('sort').value = ui.sort;
}

function card(d) {
  const usd = d.currency === 'USD';
  return `<a class="card" href="${esc(d.url)}" target="_blank" rel="noopener">
    <div class="img" data-initial="${esc(d.store[0])}"><img src="${esc(d.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('noimg')"><span class="tagoff">−${d.discount}%</span></div>
    <div class="info"><div class="store">${esc(d.store)}</div><div class="name">${esc(d.name)}</div>
      <div class="prices"${usd ? ` title="Converted from US$${d.price.toFixed(2)}"` : ''}><span class="now">${usd ? '≈' : ''}${money(d._p)}</span><span class="was">${money(wasOf(d))}</span></div></div>
  </a>`;
}

function renderGrid() {
  const grid = $('grid');
  if (!results.length) {
    grid.innerHTML = deals.length
      ? '<div class="empty"><b>Nothing matches those filters</b>Try removing one, or widen the price range.<br><button class="linkbtn" data-clearall>Clear all filters</button></div>'
      : `<div class="empty"><b>No deals yet</b>${live ? 'The first scrape is running — deals appear as each store finishes.' : 'Run a scrape to fill this page.'}</div>`;
    return;
  }
  grid.innerHTML = results.slice(0, shown).map(card).join('');
}

function showMore() {
  if (shown >= results.length) return;
  $('grid').insertAdjacentHTML('beforeend', results.slice(shown, shown + PAGE_SIZE).map(card).join(''));
  shown += PAGE_SIZE;
}

function group(id, title, body) {
  const closed = ui.closed.includes(id);
  return `<section class="fgroup${closed ? ' closed' : ''}">
    <button class="fhead" data-toggle="${id}" aria-expanded="${!closed}">${title}${ICON_CHEV}</button>
    <div class="fbody">${body}</div></section>`;
}

function option(name, value, label, n, state) {
  const type = name === 'off' ? 'radio' : 'checkbox';
  const cls = ['opt', state === 'x' ? 'x' : '', !n && !state ? 'zero' : ''].filter(Boolean).join(' ');
  return `<label class="${cls}"><input type="${type}" name="${name}" value="${esc(value)}"${state === 'on' ? ' checked' : ''}>`
    + `<span class="label">${esc(label)}</span><span class="n">${(n || 0).toLocaleString()}</span></label>`;
}

function renderFilters(words) {
  const f = ui.f;
  const tally = (skip, keys) => {
    const m = new Map();
    for (const d of deals) if (passes(d, words, skip)) for (const k of keys(d)) m.set(k, (m.get(k) || 0) + 1);
    return m;
  };
  const deptDeals = deals.filter(inDept);
  const catCounts = tally('cat', d => d._cats);
  const storeCounts = tally('store', d => [d.storeKey]);
  const offCounts = tally('off', d => [Math.floor(d.discount / 10) * 10]);
  const offAtLeast = v => [...offCounts].reduce((sum, [bucket, n]) => sum + (bucket >= v ? n : 0), 0);
  const stateOf = (inc, exc, v) => (inc.includes(v) ? 'on' : exc.includes(v) ? 'x' : '');

  const cats = [...new Set(deptDeals.flatMap(d => d._cats))].sort();
  let stores = [...new Set(deptDeals.map(d => d.storeKey))]
    .sort((a, b) => (storeCounts.get(b) || 0) - (storeCounts.get(a) || 0) || storeName(a).localeCompare(storeName(b)));
  const totalStores = stores.length;
  if (ui.storeQ) stores = stores.filter(k => storeName(k).toLowerCase().includes(ui.storeQ.toLowerCase()));
  const visible = ui.allStores || ui.storeQ ? stores : stores.slice(0, 8);
  // keep selected stores visible even when the list is collapsed
  for (const k of [...f.stores, ...f.xstores]) if (!visible.includes(k) && stores.includes(k)) visible.push(k);

  const html =
    group('cat', 'Category', cats.map(c => option('cat', c, c, catCounts.get(c), stateOf(f.cats, f.xcats, c))).join('') || '<div class="hint">No categories</div>')
    + group('store', 'Store',
      `<input class="fsearch" data-storeq placeholder="Find a store" aria-label="Find a store" value="${esc(ui.storeQ)}">`
      + visible.map(k => option('store', k, storeName(k), storeCounts.get(k), stateOf(f.stores, f.xstores, k))).join('')
      + (totalStores > 8 && !ui.storeQ ? `<button class="linkbtn" data-allstores>${ui.allStores ? 'Show fewer' : `Show all ${totalStores}`}</button>` : ''))
    + group('price', 'Price',
      `<div class="price"><label><span>$</span><input inputmode="numeric" data-min placeholder="Min" aria-label="Minimum price" value="${esc(f.min)}"></label>–`
      + `<label><span>$</span><input inputmode="numeric" data-max placeholder="Max" aria-label="Maximum price" value="${esc(f.max)}"></label></div>`)
    + group('off', 'Discount', [[0, 'Any discount'], [30, '30% off or more'], [50, '50% off or more'], [70, '70% off or more']]
      .map(([v, label]) => option('off', v, label, offAtLeast(v), f.off === v ? 'on' : '')).join(''))
    + '<p class="hint">Shift-click a category or store to exclude it.</p>';
  $('side').innerHTML = html;
  $('sheetBody').innerHTML = html;
}

// ── Header: freshness + store status ──────────────────────────────────────────
function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

function renderMeta() {
  const btn = $('meta');
  btn.classList.toggle('busy', !!live);
  btn.classList.toggle('stale', !live && !!meta.scrapedAt && Date.now() - new Date(meta.scrapedAt) > STALE_HOURS * 36e5);
  if (live) {
    const all = Object.values(live.progress);
    const done = all.filter(s => s.status !== 'pending').length;
    $('metaText').textContent = all.length ? `Refreshing · ${done} of ${all.length} stores` : 'Refreshing…';
  } else {
    const working = Object.values(meta.storeResults || {}).filter(r => r.count > 0).length;
    $('metaText').textContent = meta.scrapedAt ? `Updated ${ago(meta.scrapedAt)} · ${working} stores` : 'Not scraped yet';
  }
  $('refreshBtn').disabled = !!live;
  $('refreshBtn').classList.toggle('spin', !!live);
  if (!$('storesPop').hidden) renderStoresPop();
}

function renderStoresPop() {
  const rows = live
    ? Object.entries(live.progress).map(([k, s]) => ({ name: s.name || storeName(k), count: s.count, error: s.error, pending: s.status === 'pending' }))
    : Object.entries(meta.storeResults || {}).map(([k, r]) => ({ name: storeName(k), count: r.count, error: r.error }));
  rows.sort((a, b) => (b.pending ? 1 : 0) - (a.pending ? 1 : 0) || (b.count || 0) - (a.count || 0) || a.name.localeCompare(b.name));
  $('storesPop').innerHTML = `<h3>${live ? 'Refresh in progress' : meta.scrapedAt ? `Last scrape · ${new Date(meta.scrapedAt).toLocaleString()}` : 'No scrape yet'}</h3>`
    + rows.map(r => `<div class="prow${r.error ? ' err' : ''}${r.pending ? ' pending' : ''}"><span>${esc(r.name)}</span>`
      + `<span title="${esc(r.error || '')}">${r.pending ? 'waiting…' : r.error ? esc(r.error) : `${(r.count || 0).toLocaleString()} deals`}</span></div>`).join('');
}

function toggleStoresPop(open = $('storesPop').hidden) {
  $('storesPop').hidden = !open;
  $('meta').setAttribute('aria-expanded', open);
  if (open) renderStoresPop();
}

// ── Data loading & live refresh (local server only) ──────────────────────────
function setData(data) {
  meta = { scrapedAt: data.scrapedAt, storeResults: data.storeResults || {} };
  deals = prepare(data.deals || []);
  for (const d of deals) storeNames.set(d.storeKey, d.store);
  render();
  renderMeta();
}

let renderTimer = null;
const renderSoon = () => { clearTimeout(renderTimer); renderTimer = setTimeout(render, 250); };

function startRefresh() {
  if (STATIC || live) return;
  live = { progress: {} };
  renderMeta();
  const es = new EventSource('/api/refresh');
  const track = data => { if (data.liveStoreProgress) live.progress = data.liveStoreProgress; renderMeta(); };
  es.addEventListener('started', e => track(JSON.parse(e.data)));
  es.addEventListener('partial', e => {
    const data = JSON.parse(e.data);
    track(data);
    if (data.deals?.length) {
      deals = deals.filter(d => d.storeKey !== data.storeKey).concat(prepare(data.deals));
      storeNames.set(data.storeKey, data.deals[0].store);
      renderSoon();
    }
  });
  const finish = async () => {
    es.close();
    live = null;
    try { setData(await (await fetch('/api/deals')).json()); } catch (_) { renderMeta(); }
  };
  es.addEventListener('complete', finish);
  es.addEventListener('error', e => { if (e.data) finish(); }); // server-sent error event
  es.onerror = () => { if (live) finish(); };                    // connection dropped
}

async function init() {
  loadFilters();
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('no server');
    config = await res.json();
  } catch (_) {
    STATIC = true;
    document.documentElement.classList.add('static');
    try { config = await (await fetch('config.json')).json(); } catch (_) {}
  }

  $('grid').innerHTML = Array.from({ length: 12 }, () => '<div class="card skel"><div class="img"></div><div class="bar1"></div><div class="bar2"></div></div>').join('');
  try {
    const res = await fetch(STATIC ? 'deals.json' : '/api/deals');
    setData(res.status === 204 ? { deals: [] } : await res.json());
  } catch (_) {
    setData({ deals: [] });
  }

  if (!STATIC) {
    try {
      const status = await (await fetch('/api/status')).json();
      if (status.scrapeInProgress || !deals.length) startRefresh();
    } catch (_) {}
  }
  setInterval(renderMeta, 60000);
}

// ── Events ────────────────────────────────────────────────────────────────────
// click: include / un-include; shift-click: exclude / un-exclude; clicking an excluded one clears it
function toggleFacet(kind, value, exclude) {
  const f = ui.f;
  const inc = kind === 'cat' ? 'cats' : 'stores';
  const exc = 'x' + inc;
  const drop = key => { f[key] = f[key].filter(v => v !== value); };
  if (exclude) {
    if (f[exc].includes(value)) drop(exc);
    else { drop(inc); f[exc].push(value); }
  } else if (f[exc].includes(value)) {
    drop(exc);
  } else if (f[inc].includes(value)) {
    drop(inc);
  } else {
    f[inc].push(value);
  }
}

function commit() { saveFilters(); render(); }

document.addEventListener('click', e => {
  // Facet checkboxes are handled on 'click' (not 'change') so shift-click can mean "exclude"
  // (handled on the label, whose default would re-fire a synthetic click on the input)
  const input = e.target.closest('.opt')?.querySelector('input');
  if (input && (input.name === 'cat' || input.name === 'store')) {
    e.preventDefault();
    toggleFacet(input.name, input.value, e.shiftKey);
    commit();
    return;
  }
  if (!e.target.closest('.meta-wrap') && !$('storesPop').hidden) toggleStoresPop(false);
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.dept) {
    saveFilters();
    ui.dept = b.dataset.dept;
    saved.set('dept', ui.dept);
    loadFilters();
    ui.storeQ = '';
    render();
    window.scrollTo({ top: 0 });
  } else if (b.dataset.toggle) {
    const id = b.dataset.toggle;
    ui.closed = ui.closed.includes(id) ? ui.closed.filter(x => x !== id) : [...ui.closed, id];
    saved.set('closedGroups', ui.closed);
    renderFilters(searchWords());
  } else if (b.hasAttribute('data-allstores')) {
    ui.allStores = !ui.allStores;
    renderFilters(searchWords());
  } else if (b.dataset.chip) {
    const { chip, v } = b.dataset;
    if (chip === 'off') ui.f.off = 0;
    else if (chip === 'price') ui.f.min = ui.f.max = '';
    else ui.f[chip] = ui.f[chip].filter(x => x !== v);
    commit();
  } else if (b.hasAttribute('data-clearall')) {
    ui.f = blankFilters();
    ui.q = $('q').value = '';
    commit();
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.name === 'off') ui.f.off = +t.value;
  else if (t.matches('[data-min]')) ui.f.min = t.value.replace(/[^\d.]/g, '');
  else if (t.matches('[data-max]')) ui.f.max = t.value.replace(/[^\d.]/g, '');
  else return;
  commit();
});

// Store-name search re-renders its own list; restore focus/caret afterwards
document.addEventListener('input', e => {
  const t = e.target;
  if (!t.matches('[data-storeq]')) return;
  ui.storeQ = t.value;
  const inSheet = !!t.closest('.sheet');
  const pos = t.selectionStart;
  renderFilters(searchWords());
  const again = document.querySelector((inSheet ? '#sheetBody' : '#side') + ' [data-storeq]');
  again.focus();
  again.setSelectionRange(pos, pos);
});

let searchTimer = null;
$('q').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { ui.q = e.target.value.trim(); render(); }, 150);
});
$('sort').addEventListener('change', e => { ui.sort = e.target.value; saved.set('sort', ui.sort); render(); });
$('meta').addEventListener('click', () => toggleStoresPop());
$('refreshBtn').addEventListener('click', startRefresh);
$('themeBtn').addEventListener('click', () => {
  const dark = getComputedStyle(document.documentElement).colorScheme === 'dark';
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  saved.set('theme', document.documentElement.dataset.theme);
});

const sheet = open => {
  $('sheet').classList.toggle('open', open);
  $('sheetBg').classList.toggle('open', open);
  document.body.classList.toggle('sheet-open', open);
};
$('openSheet').addEventListener('click', () => sheet(true));
['closeSheet', 'sheetBg', 'applySheet'].forEach(id => $(id).addEventListener('click', () => sheet(false)));

document.addEventListener('keydown', e => {
  if (e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $('q').focus(); }
  if (e.key === 'Escape') { toggleStoresPop(false); sheet(false); }
});

// Infinite scroll: load the next page when within ~1.5 screens of the bottom
window.addEventListener('scroll', () => {
  if (innerHeight + scrollY > document.documentElement.scrollHeight - innerHeight * 1.5) showMore();
}, { passive: true });

init();
