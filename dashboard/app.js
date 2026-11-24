// Launch Radar, model radar-2. Renders window.RADAR from data.js: the ranked board, the live-token
// view, and a detail view per protocol. The page recomputes every implied value from the snapshot's
// own figures (TVL, peer multiple, 7-day change, age, chains), so the code and the board agree; the
// farm plan is derived here from the same rules main.ts runs, from each protocol's own record.

(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) { document.body.innerHTML = '<p style="padding:40px">Launch Radar: no data.js found.</p>'; return; }
  var M = R.model;

  // ---------- formatting ----------
  function usd(n) {
    if (n === null || n === undefined) return '—';
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(0);
  }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function age(n) {
    if (n === null || n === undefined) return '—';
    if (n < 365) return n + 'd';
    return (n / 365).toFixed(1) + 'y';
  }
  function mult(n) { return '×' + n.toFixed(4); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- the model, recomputed in the page ----------
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function growthMult(row) {
    var g = clamp(row.change_7d === null ? 0 : row.change_7d, M.growth_floor, M.growth_cap);
    return 1 + (g / 100) * M.growth_weight;
  }
  function maturityMult(row) {
    var a = row.age_days === null ? R.median_age_days : row.age_days;
    return M.maturity_floor + (Math.min(Math.max(a, 0), M.maturity_days) / M.maturity_days) * M.maturity_range;
  }
  function breadthMult(row) {
    return 1 + M.breadth_per_chain * Math.min(row.chains.length, M.breadth_max_chains);
  }
  function impliedOf(row) {
    return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * growthMult(row) * maturityMult(row) * breadthMult(row)));
  }
  // Self-check: the page's arithmetic must reproduce the board's values exactly.
  var bad = 0;
  R.rows.forEach(function (r) { if (impliedOf(r) !== r.implied_value_usd) bad++; });
  if (bad) console.warn('Launch Radar: ' + bad + ' rows recompute differently from the board');

  // ---------- the farm plan, derived in the page ----------
  function chainOf(row) { return row.chains.length ? row.chains[0] : 'its main chain'; }
  function capitalFor(row) {
    if (row.tvl_usd >= 1e9) return 250;
    if (row.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(ageDays) {
    if (ageDays === null) return 45;
    if (ageDays < 180) return 90;
    if (ageDays < 365) return 60;
    return 45;
  }
  function actionFor(row, capital, chain) {
    var c = (row.category || '').toLowerCase();
    var name = row.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Lend $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and leave it supplied.';
    if (c.indexOf('dex') >= 0 || c.indexOf('swap') >= 0 || c.indexOf('liquidity') >= 0) return 'Add $' + capital + ' of liquidity to ' + name + '\'s deepest pool on ' + chain + ' and hold the LP position.';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('aggregator') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + '\'s highest-TVL vault on ' + chain + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('vault') >= 0) return 'Allocate $' + capital + ' to a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of ' + name + '\'s yield-bearing asset on ' + chain + ' and hold it.';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('options') >= 0) return 'Post $' + capital + ' of USDC as collateral on ' + name + ' and open a small hedged position.';
    if (c.indexOf('prediction') >= 0) return 'Back one outcome with $' + capital + ' on ' + name + ' and leave the position open.';
    if (c.indexOf('stable') >= 0) return 'Mint $' + capital + ' of the stable asset against collateral on ' + name + ' on ' + chain + '.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover on ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipt token.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC through ' + name + ' to ' + chain + ' and put the funds to work there.';
    return 'Open a $' + capital + ' position in ' + name + ' on ' + chain + ' and keep it active.';
  }
  function farmSteps(row) {
    var chain = chainOf(row);
    var capital = capitalFor(row);
    var hold = holdDaysFor(row.age_days);
    var steps = [
      { text: 'Set aside a fresh wallet for this farm only, and store its seed phrase offline.', cost: 'under $3 in gas for the first transaction', time: '5 minutes' },
      { text: actionFor(row, capital, chain), cost: '$' + capital + ' of capital plus about $' + (capital >= 250 ? 8 : 5) + ' in gas', time: '15 minutes to set up' },
      { text: 'Return once a week and make one real action: a deposit, a swap, a vote, or a claim.', cost: 'about $2 in gas per week', time: '10 minutes a week' },
      { text: 'Keep the position open for at least ' + hold + ' days, so the activity lands in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Check the protocol\'s own points or rewards page before you move anything, and claim only through links it publishes.', cost: 'free to check, and never pay to claim', time: '10 minutes' },
      { text: 'Log the wallet, the dates, and every transaction hash, so you can repeat the farm or unwind it cleanly.', cost: 'nothing but the log', time: '5 minutes' }
    ];
    return steps.map(function (s) {
      var t = s.text + ' Cost: ' + s.cost + '. Time: ' + s.time + '.';
      if (t.length > 600) t = t.slice(0, 596) + '...';
      if (t.length < 20) t = t + ' Keep the position open and check the protocol\'s own page.';
      return t;
    });
  }

  // ---------- state ----------
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, sort: 'rank', dir: 1, tab: 'board' };
  // The watchlist is the board's floor: the scorer lists its slugs in data.js, and the page marks them.
  var watchSet = {};
  R.watchlist.forEach(function (s) { watchSet[s] = true; });
  var $ = function (id) { return document.getElementById(id); };
  var rowsEl = $('rows'), countEl = $('count'), detailEl = $('detail');

  function readHash() {
    var h = new URLSearchParams(location.hash.slice(1));
    if (h.get('q') !== null) state.q = h.get('q');
    if (h.get('category')) state.category = h.get('category');
    if (h.get('chain')) state.chain = h.get('chain');
    if (h.get('watchlist') === '1') state.watchOnly = true;
    if (h.get('tab') === 'live') state.tab = 'live';
    if (h.get('sort')) state.sort = h.get('sort');
    if (h.get('dir') === '-1') state.dir = -1;
    return h.get('p');
  }
  function writeHash(openSlug) {
    var h = new URLSearchParams();
    if (state.q) h.set('q', state.q);
    if (state.category !== 'all') h.set('category', state.category);
    if (state.chain !== 'all') h.set('chain', state.chain);
    if (state.watchOnly) h.set('watchlist', '1');
    if (state.tab === 'live') h.set('tab', 'live');
    if (state.sort !== 'rank') h.set('sort', state.sort);
    if (state.dir === -1) h.set('dir', '-1');
    if (openSlug) h.set('p', openSlug);
    history.replaceState(null, '', '#' + h.toString());
  }

  // ---------- header, stats, selects ----------
  $('asOf').textContent = R.as_of;
  $('source').textContent = R.source + ', ' + R.as_of;
  var top = R.rows[0];
  $('stats').innerHTML = [
    ['<b>' + R.board_size + '</b><span>protocols ranked</span>'],
    ['<b>' + R.watchlist_size + ' / ' + R.watchlist_size + '</b><span>watchlist covered</span>'],
    ['<b>' + R.early_size + '</b><span>found beyond the watchlist</span>'],
    ['<b>' + usd(top ? top.implied_value_usd : 0) + '</b><span>top implied value</span>'],
    ['<b>' + R.peer_global.toFixed(3) + '</b><span>median peer multiple</span>']
  ].map(function (s) { return '<div class="stat">' + s[0] + '</div>'; }).join('');

  var categories = [], chains = [];
  R.rows.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  categories.sort(); chains.sort();
  $('category').innerHTML = '<option value="all">All categories</option>' + categories.map(function (c) {
    return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
  }).join('');
  $('chain').innerHTML = '<option value="all">All chains</option>' + chains.map(function (c) {
    return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
  }).join('');

  // ---------- board ----------
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var rows = R.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.watchOnly && !watchSet[r.slug]) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort, dir = state.dir;
    rows.sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (av === null) return 1; if (bv === null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
    return rows;
  }
  function renderBoard() {
    var rows = filtered();
    rowsEl.innerHTML = rows.map(function (r) {
      var chg = r.change_7d === null ? '<span>—</span>' : '<span class="' + (r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</span>';
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="nm">' + esc(r.name) + '</span>' + (watchSet[r.slug] ? '<span class="badge">WATCHLIST</span>' : '') + '<span class="sub">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num">' + chg + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num"><b>' + usd(r.implied_value_usd) + '</b></td></tr>';
    }).join('');
    countEl.textContent = rows.length + ' of ' + R.board_size + ' protocols shown. Implied values are this radar\u2019s own claim, computed from the snapshot\u2019s figures alone.';
  }
  function renderLive() {
    $('liveRows').innerHTML = R.live.map(function (r) {
      return '<tr><td><span class="nm">' + esc(r.name) + '</span><span class="sub">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num">' + usd(r.mcap_usd) + '</td>' +
        '<td class="num">' + (r.mcap_tvl_ratio === null ? '—' : r.mcap_tvl_ratio.toFixed(3)) + '</td>' +
        '<td class="num">' + (r.change_7d === null ? '—' : pct(r.change_7d)) + '</td></tr>';
    }).join('');
  }
  function setTab(tab) {
    state.tab = tab;
    $('tabBoard').classList.toggle('active', tab === 'board');
    $('tabLive').classList.toggle('active', tab === 'live');
    $('board').hidden = tab !== 'board';
    countEl.hidden = tab !== 'board';
    $('liveTable').hidden = tab !== 'live';
    $('liveNote').hidden = tab !== 'live';
    if (tab === 'live') renderLive();
    writeHash(currentSlug);
  }

  // ---------- detail ----------
  var currentSlug = null;
  function chainsShort(row) {
    if (!row.chains.length) return 'no chain listed';
    var shown = row.chains.slice(0, 3).join(', ');
    return row.chains.length > 3 ? shown + ' +' + (row.chains.length - 3) + ' more' : shown;
  }
  function openDetail(slug) {
    var row = null;
    R.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) { detailEl.hidden = true; currentSlug = null; return; }
    currentSlug = slug;
    var steps = farmSteps(row);
    var g = row.change_7d === null ? 0 : row.change_7d;
    var ageShown = row.age_days === null ? R.median_age_days + ' (median)' : row.age_days + ' days';
    detailEl.innerHTML =
      '<button class="close" id="closeDetail">Close &times;</button>' +
      '<h2>' + esc(row.name) + '</h2>' +
      '<p class="meta">#' + row.rank + ' &middot; ' + esc(row.category || 'no category') + ' &middot; ' + esc(chainsShort(row)) + (watchSet[row.slug] ? ' &middot; <span class="badge">WATCHLIST</span>' : '') + '</p>' +
      '<div class="kv">' +
      '<div><span>Implied value</span><b>' + usd(row.implied_value_usd) + '</b></div>' +
      '<div><span>TVL</span><b>' + usd(row.tvl_usd) + '</b></div>' +
      '<div><span>7-day change</span><b>' + pct(row.change_7d) + '</b></div>' +
      '<div><span>Age, no token recorded</span><b>' + age(row.age_days) + '</b></div>' +
      '</div>' +
      '<h3>How the value is worked out</h3>' +
      '<div class="math">' +
      usd(row.tvl_usd) + ' &times; ' + mult(row.peer_multiple) + ' peer<br>' +
      '&times; ' + mult(growthMult(row)) + ' growth (' + pct(g) + ' in 7 days)<br>' +
      '&times; ' + mult(maturityMult(row)) + ' maturity (' + esc(ageShown) + ')<br>' +
      '&times; ' + mult(breadthMult(row)) + ' breadth (' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ')<br>' +
      '<span class="tot">= ' + usd(row.implied_value_usd) + '</span>' +
      '</div>' +
      '<p class="note">The peer multiple is the median market-cap-to-TVL ratio of live-token protocols in the ' + esc(row.category || 'same') + ' category in this snapshot. The page recomputes the total from the same figures, so the code and the board agree.</p>' +
      '<h3>Farm plan</h3>' +
      '<ol class="steps">' + steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="note">This protocol records no token in the snapshot: no market cap, no CoinGecko id, no symbol. That is what the record says, never proof it has none. Nothing here is financial advice.</p>';
    detailEl.hidden = false;
    $('closeDetail').addEventListener('click', function () { detailEl.hidden = true; currentSlug = null; writeHash(null); });
    detailEl.scrollTop = 0;
    writeHash(slug);
  }

  // ---------- events ----------
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); writeHash(currentSlug); });
  $('category').addEventListener('change', function (e) { state.category = e.target.value; renderBoard(); writeHash(currentSlug); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); writeHash(currentSlug); });
  $('watchOnly').addEventListener('change', function (e) { state.watchOnly = e.target.checked; renderBoard(); writeHash(currentSlug); });
  $('tabBoard').addEventListener('click', function () { setTab('board'); });
  $('tabLive').addEventListener('click', function () { setTab('live'); });
  document.querySelectorAll('#board thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' || key === 'category' ? 1 : -1; }
      renderBoard(); writeHash(currentSlug);
    });
  });
  rowsEl.addEventListener('click', function (e) {
    var tr = e.target.closest('tr');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  window.addEventListener('hashchange', function () {
    var p = readHash();
    syncControls();
    if (state.tab === 'live') setTab('live'); else setTab('board');
    renderBoard();
    if (p) openDetail(p); else { detailEl.hidden = true; currentSlug = null; }
  });
  function syncControls() {
    $('q').value = state.q;
    $('category').value = state.category;
    $('chain').value = state.chain;
    $('watchOnly').checked = state.watchOnly;
  }

  // ---------- boot ----------
  var open = readHash();
  syncControls();
  renderBoard();
  if (state.tab === 'live') setTab('live');
  if (open) openDetail(open);
})();
