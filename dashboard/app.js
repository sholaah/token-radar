/* Token Radar page. Reads window.RADAR, which main.ts writes beside the page,
   and renders three things: the ranked board, a detail view for any protocol
   (deep-linkable at #/p/<slug>) and the live-token set the model sets aside.
   No framework, no fetch, no network. */

(function () {
  'use strict';

  var R = window.RADAR;
  var root = document.getElementById('main');

  if (!R || !Array.isArray(R.rows)) {
    root.innerHTML = '<div class="empty">No data. <span>' +
      'data.js did not load, so there is nothing to rank.</span></div>';
    return;
  }

  /* ---------- formatting ---------- */

  function usd(n) {
    if (n === null || n === undefined) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'k';
    return '$' + Math.round(n);
  }

  function pct(n) {
    if (n === null || n === undefined) return null;
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /* ---------- state ---------- */

  var state = { sort: 'rank', dir: 1, q: '', cat: 'all', chain: 'all', scope: 'all' };

  var CATEGORIES = uniq(R.rows.map(function (r) { return r.category; }).filter(Boolean)).sort();
  var CHAINS = uniq(R.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, [])).sort();

  function uniq(list) {
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (!seen[list[i]]) { seen[list[i]] = 1; out.push(list[i]); }
    }
    return out;
  }

  /* ---------- header ---------- */

  function headline() {
    var top = R.rows[0];
    var total = R.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var watch = R.rows.filter(function (r) { return r.on_watchlist; });

    var top_ = el('header', 'top');
    var row = el('div', 'top-row');
    var h1 = el('h1', 'title');
    h1.appendChild(document.createTextNode('Token '));
    h1.appendChild(el('span', '', 'Radar'));
    row.appendChild(h1);

    var meta = el('div', 'meta');
    meta.innerHTML = 'snapshot <b>' + R.as_of + '</b> &nbsp;|&nbsp; model <b>' + R.model_version +
      '</b> &nbsp;|&nbsp; floor <b>' + usd(R.floor_usd) + '</b>';
    row.appendChild(meta);
    top_.appendChild(row);

    var stats = el('div', 'stats');
    stats.appendChild(stat('protocols ranked', String(R.board_size), 'pre-token, no token recorded'));
    stats.appendChild(stat('on the watchlist', String(R.watchlist_size), 'the floor, never the ceiling'));
    stats.appendChild(stat('called early', String(R.early_size), 'outside the watchlist, ranked too'));
    stats.appendChild(stat('total implied value', usd(total), 'sum of every row'));
    stats.appendChild(stat('token already trades', String(R.live_size), 'set aside, not ranked'));
    top_.appendChild(stats);

    var cards = el('div', 'top3');
    for (var i = 0; i < Math.min(3, R.rows.length); i++) cards.appendChild(top3Card(R.rows[i]));
    top_.push = null;
    top_.appendChild(cards);

    if (top) top_.setAttribute('data-top', top.slug);
    return top_;
  }

  function stat(label, value, note) {
    var s = el('div', 'stat');
    s.appendChild(el('span', 'stat-label', label));
    var v = el('span', 'stat-value' + (label === 'total implied value' ? ' accent' : ''), value);
    s.appendChild(v);
    s.appendChild(el('span', 'stat-note', note));
    return s;
  }

  function top3Card(r) {
    var c = el('article', 'card');
    c.tabIndex = 0;
    c.setAttribute('role', 'link');
    c.setAttribute('aria-label', 'Rank ' + r.rank + ', ' + r.name);
    c.appendChild(el('div', 'top3-rank', 'rank ' + r.rank));
    c.appendChild(el('div', 'top3-name', r.name));
    c.appendChild(el('div', 'top3-cat', (r.category || 'no category') + ' | ' + (r.chains || []).slice(0, 2).join(', ')));
    c.appendChild(el('div', 'top3-val', usd(r.implied_value_usd)));
    c.appendChild(el('div', 'top3-note',
      'TVL ' + usd(r.tvl_usd) + ' × multiple ' + r.category_multiple +
      ' × growth ' + r.growth_multiplier + ' × maturity ' + r.maturity_multiplier +
      ' × chain ' + r.chain_factor));
    c.addEventListener('click', function () { location.hash = '#/p/' + r.slug; });
    c.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); location.hash = '#/p/' + r.slug; }
    });
    return c;
  }

  /* ---------- controls ---------- */

  function controls() {
    var bar = el('div', 'controls');

    var searchField = el('div', 'field');
    var searchId = 'f-search';
    var searchLabel = el('label', '', 'Search');
    searchLabel.setAttribute('for', searchId);
    searchField.appendChild(searchLabel);
    var search = document.createElement('input');
    search.type = 'search';
    search.id = searchId;
    search.placeholder = 'protocol, category or chain';
    search.value = state.q;
    search.addEventListener('input', function () {
      state.q = search.value;
      renderTable();
    });
    searchField.appendChild(search);
    bar.appendChild(searchField);

    bar.appendChild(selectField('f-cat', 'Category', CATEGORIES, state.cat, function (v) {
      state.cat = v; renderTable();
    }));
    bar.appendChild(selectField('f-chain', 'Chain', CHAINS, state.chain, function (v) {
      state.chain = v; renderTable();
    }));

    var scopeField = el('div', 'field');
    scopeField.appendChild(el('label', '', 'Rows'));
    var chips = el('div', 'chips');
    [['all', 'All ranked'], ['watchlist', 'Watchlist']].forEach(function (pair) {
      var b = el('button', 'chip', pair[1]);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.scope === pair[0]));
      b.addEventListener('click', function () {
        state.scope = pair[0];
        var all = chips.querySelectorAll('.chip');
        for (var i = 0; i < all.length; i++) {
          all[i].setAttribute('aria-pressed', String(all[i] === b));
        }
        renderTable();
      });
      chips.appendChild(b);
    });
    scopeField.appendChild(chips);
    bar.appendChild(scopeField);

    var count = el('div', 'count');
    count.id = 'row-count';
    bar.appendChild(count);

    return bar;
  }

  function selectField(id, label, options, current, onChange) {
    var field = el('div', 'field');
    var lab = el('label', '', label);
    lab.setAttribute('for', id);
    field.appendChild(lab);
    var sel = document.createElement('select');
    sel.id = id;
    var all = document.createElement('option');
    all.value = 'all';
    all.textContent = 'All';
    sel.appendChild(all);
    options.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      sel.appendChild(opt);
    });
    sel.value = current;
    sel.addEventListener('change', function () { onChange(sel.value); });
    field.appendChild(sel);
    return field;
  }

  /* ---------- the board ---------- */

  var COLUMNS = [
    { key: 'rank', label: 'Rank', cls: 'rank', align: 'num' },
    { key: 'name', label: 'Protocol', cls: 'name' },
    { key: 'category', label: 'Category', cls: 'cat col-cat' },
    { key: 'chains', label: 'Chains', cls: 'chains col-chains', noSort: true },
    { key: 'tvl_usd', label: 'TVL', align: 'num', fmt: usd },
    { key: 'change_7d', label: '7d', align: 'num', fmt: pct },
    { key: 'implied_value_usd', label: 'Implied value', align: 'num', fmt: usd, strong: true },
    { key: 'confidence', label: 'Confidence', align: 'num' }
  ];

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return R.rows.filter(function (r) {
      if (state.scope === 'watchlist' && !r.on_watchlist) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) === -1) return false;
      if (q) {
        var hay = (r.name + ' ' + (r.category || '') + ' ' + (r.chains || []).join(' ')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function sorted(rows) {
    var key = state.sort;
    var dir = state.dir;
    var copy = rows.slice();
    copy.sort(function (a, b) {
      var x = a[key];
      var y = b[key];
      if (Array.isArray(x)) x = x.join(' ');
      if (Array.isArray(y)) y = y.join(' ');
      if (x === null || x === undefined) x = -Infinity;
      if (y === null || y === undefined) y = -Infinity;
      if (typeof x === 'string' || typeof y === 'string') {
        return String(x).localeCompare(String(y)) * dir;
      }
      return (x - y) * dir;
    });
    return copy;
  }

  function table(rows) {
    var wrap = el('div', 'table-wrap');
    var t = el('table', 'board');
    var cap = el('caption', 'sr-only', 'Pre-token protocols ranked by implied token value');
    t.appendChild(cap);

    var thead = el('thead');
    var hr = el('tr');
    COLUMNS.forEach(function (col) {
      var th = el('th', col.noSort ? 'no-sort' : '');
      th.textContent = col.label;
      if (col.align === 'num') th.style.textAlign = 'right';
      if (!col.noSort) {
        th.tabIndex = 0;
        th.setAttribute('role', 'button');
        if (state.sort === col.key) th.setAttribute('aria-sort', state.dir === 1 ? 'ascending' : 'descending');
        th.addEventListener('click', function () { sortBy(col.key); });
        th.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(col.key); }
        });
      }
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    t.appendChild(thead);

    var tbody = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr');
      tr.tabIndex = 0;
      tr.setAttribute('data-slug', r.slug);
      tr.setAttribute('aria-label', r.name + ', rank ' + r.rank);
      COLUMNS.forEach(function (col) {
        var td = el('td', (col.cls || '') + (col.align === 'num' ? ' num' : ''));
        if (col.strong) td.className += ' val';
        if (col.key === 'rank') td.textContent = String(r.rank);
        else if (col.key === 'name') {
          td.textContent = r.name;
          if (!r.on_watchlist) {
            var tag = el('span', 'watch no', '  early');
            td.appendChild(tag);
          }
        }
        else if (col.key === 'chains') td.textContent = (r.chains || []).join(', ');
        else if (col.key === 'confidence') {
          td.appendChild(el('span', 'conf ' + r.confidence_label, r.confidence_label));
        }
        else if (col.key === 'change_7d') {
          var v = pct(r.change_7d);
          if (v === null) td.appendChild(el('span', 'delta none', 'n/a'));
          else {
            var s = el('span', 'delta ' + (r.change_7d >= 0 ? 'pos' : 'neg'), v);
            td.appendChild(s);
          }
        }
        else td.textContent = col.fmt ? col.fmt(r[col.key]) : String(r[col.key]);
        tr.appendChild(td);
      });
      tr.addEventListener('click', function () { location.hash = '#/p/' + r.slug; });
      tr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { location.hash = '#/p/' + r.slug; }
      });
      tbody.appendChild(tr);
    });
    t.appendChild(tbody);
    wrap.appendChild(t);
    return wrap;
  }

  function sortBy(key) {
    if (state.sort === key) state.dir = -state.dir;
    else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
    renderTable();
  }

  var tableHost = null;

  function renderTable() {
    if (!tableHost) return;
    var rows = sorted(filtered());
    var count = document.getElementById('row-count');
    if (count) count.innerHTML = '<b>' + rows.length + '</b> of ' + R.board_size + ' rows';
    clear(tableHost);
    if (rows.length === 0) {
      tableHost.appendChild(emptyState());
      return;
    }
    tableHost.appendChild(table(rows));
  }

  function emptyState() {
    var e = el('div', 'empty', 'No protocol matches these filters.');
    e.appendChild(el('span', 'note', 'Widen the search, pick another category or switch to All ranked.'));
    return e;
  }

  /* ---------- detail ---------- */

  function detail(slug) {
    var r = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) r = R.rows[i];
    if (!r) {
      var miss = el('div', 'empty', 'No protocol named "' + slug + '" in this snapshot.');
      var back = el('button', 'back', '\u2190 back to the board');
      back.addEventListener('click', function () { location.hash = ''; });
      miss.appendChild(back);
      return miss;
    }

    var wrap = el('article', 'detail');

    var backBtn = el('button', 'back', '\u2190 back to the board');
    backBtn.type = 'button';
    backBtn.addEventListener('click', function () { location.hash = ''; });
    wrap.appendChild(backBtn);

    var head = el('div', 'detail-head');
    var left = el('div');
    left.appendChild(el('h2', 'detail-name', r.name));
    var sub = el('div', 'detail-sub');
    sub.textContent = (r.category || 'no category') + ' | ' + chainsBrief(r.chains) +
      ' | records no token' + (r.listed_at ? ', tracked since ' + r.listed_at : '') +
      ' | ' + (r.on_watchlist ? 'on the watchlist' : 'called early, below the watchlist floor');
    left.appendChild(sub);
    head.appendChild(left);

    var val = el('div', 'detail-value');
    val.appendChild(el('div', 'small', 'implied value'));
    val.appendChild(el('div', 'big', usd(r.implied_value_usd)));
    head.appendChild(val);
    wrap.appendChild(head);

    var grid = el('div', 'detail-grid');

    /* the arithmetic, factor by factor */
    var leftCol = el('section');
    leftCol.appendChild(el('h3', 'section-title', 'How the number is built'));
    var formula = el('div', 'formula');
    formulaRow(formula, 'TVL today', usd(r.tvl_usd));
    formulaRow(formula, 'category multiple ' + (r.category || 'no category'),
      '× ' + r.category_multiple);
    formulaRow(formula, '7d growth ' + (pct(r.change_7d) === null ? 'unreported, 0%' : pct(r.change_7d)),
      '× ' + r.growth_multiplier);
    formulaRow(formula, 'maturity ' + (r.age_days === null ? 'age unknown, 365 days assumed' : r.age_days + ' days tokenless'),
      '× ' + r.maturity_multiplier);
    formulaRow(formula, 'chains ' + ((r.chains || []).length || 'none recorded'), '× ' + r.chain_factor);
    var total = el('div', 'formula-row total');
    total.appendChild(el('span', 'formula-k', 'implied value'));
    total.appendChild(el('span', 'formula-v', usd(r.implied_value_usd)));
    formula.appendChild(total);
    leftCol.appendChild(formula);

    var note = el('p', 'note',
      'The multiple is the median market cap over TVL of this category\'s protocols that already trade, ' +
      'shrunk toward the all-protocol default of ' + R.model.default_multiple + '. Growth is clamped to ' +
      R.model.growth_floor + ' to ' + R.model.growth_cap + ' per cent and weighted at ' + R.model.growth_weight +
      '. Maturity runs ' + R.model.maturity_floor + ' to ' + (R.model.maturity_floor + R.model.maturity_range) +
      ' across ' + R.model.maturity_days + ' days. This is the model\'s own estimate of what a token might be ' +
      'worth if the record stayed as it is. It is not a price, not a prediction that a token launches, and ' +
      'not make.fun\'s claim.');
    leftCol.appendChild(note);
    grid.appendChild(leftCol);

    /* the record and its confidence */
    var rightCol = el('section');
    rightCol.appendChild(el('h3', 'section-title', 'The record behind it'));
    var facts = el('dl', 'facts');
    fact(facts, 'rank', String(r.rank) + ' of ' + R.board_size);
    fact(facts, 'TVL', usd(r.tvl_usd));
    fact(facts, '7d change', pct(r.change_7d) === null ? 'unreported' : pct(r.change_7d));
    fact(facts, 'tokenless for', r.age_days === null ? 'unknown' : r.age_days + ' days');
    fact(facts, 'chains', chainsBrief(r.chains));
    fact(facts, 'confidence', r.confidence_label + ' (' + Math.round(r.confidence * 100) + '%)');
    rightCol.appendChild(facts);

    if ((r.chains || []).length > 3) {
      rightCol.appendChild(el('p', 'note', 'Every chain it runs on: ' + r.chains.join(', ') + '.'));
    }

    var caveat = el('p', 'note',
      'Confidence rises with a known listing date, a reported seven-day change, a category with live ' +
      'comparables and at least $20M of TVL. A protocol whose record is thin is still ranked, but its ' +
      'number rests on the default multiple.');
    rightCol.appendChild(caveat);
    grid.appendChild(rightCol);

    /* the farm plan */
    var plan = el('section');
    plan.style.gridColumn = '1 / -1';
    plan.appendChild(el('h3', 'section-title', 'How to farm it'));
    if (!r.farm || r.farm.length === 0) {
      plan.appendChild(el('p', 'note', 'This protocol has no plan in the data.'));
    } else {
      var ol = el('ol', 'steps');
      r.farm.forEach(function (s) {
        var li = el('li', 'step');
        li.appendChild(el('div', 'step-action', s.action));
        var meta = el('div', 'step-meta');
        if (s.cost) meta.appendChild(el('span', 'pill cost', 'cost: ' + s.cost));
        if (s.time) meta.appendChild(el('span', 'pill time', 'time: ' + s.time));
        li.appendChild(meta);
        ol.appendChild(li);
      });
      plan.appendChild(ol);
    }
    grid.appendChild(plan);

    wrap.appendChild(grid);
    return wrap;
  }

  function formulaRow(host, k, v) {
    var row = el('div', 'formula-row');
    row.appendChild(el('span', 'formula-k', k));
    row.appendChild(el('span', 'formula-v', v));
    host.appendChild(row);
  }

  function fact(host, k, v) {
    host.appendChild(el('dt', '', k));
    host.appendChild(el('dd', '', v));
  }

  /* A chain list can run to a dozen names, so the facts column shows the first
     three and the count: the full list is already in the header line. */
  function chainsBrief(chains) {
    if (!chains || chains.length === 0) return 'none recorded';
    if (chains.length <= 3) return chains.join(', ');
    return chains.slice(0, 3).join(', ') + ' and ' + (chains.length - 3) + ' more';
  }

  /* ---------- live set ---------- */

  function live() {
    var wrap = el('section');
    wrap.appendChild(el('h3', 'section-title',
      'Token already trades: ' + R.live_size + ' protocols the board excludes'));
    wrap.appendChild(el('p', 'note',
      'A protocol whose token already trades has a market cap, so the board does not estimate one. ' +
      'They are listed here, biggest first, because they are what the multiples above are built from.'));

    var host = el('div');
    R.live.forEach(function (r) {
      var row = el('div', 'live-row');
      var left = el('div', 'live-name', r.name);
      left.appendChild(el('span', 'live-cat', r.symbol ? r.symbol + ' | ' + (r.category || 'no category') : (r.category || 'no category')));
      row.appendChild(left);
      row.appendChild(el('span', 'live-mcap', usd(r.mcap_usd)));
      row.appendChild(el('span', 'live-mult', r.mcap_to_tvl === null ? 'n/a' : r.mcap_to_tvl.toFixed(2) + 'x TVL'));
      host.appendChild(row);
    });
    wrap.appendChild(host);
    return wrap;
  }

  /* ---------- footer ---------- */

  function footer() {
    var f = el('footer', 'foot');
    var p1 = el('p', '', 'Source: ' + R.source + '. Ranked by the ' + R.model_version + ' model: TVL x category multiple x 7d growth x maturity x chain factor. ' +
      'Every number here comes from the sealed snapshot this page was built with, not from a live feed.');
    var p2 = el('p', '', 'A protocol "records no token" in this snapshot. That is not proof it has none: a token its record does not carry may exist. ' +
      'The implied value is the entry\'s own claim and no advice; farm plans are generic steps, not an endorsement of any protocol.');
    f.appendChild(p1);
    f.appendChild(p2);
    return f;
  }

  /* ---------- router ---------- */

  function boardView() {
    var frag = document.createDocumentFragment();
    frag.appendChild(headline());
    frag.appendChild(controls());
    tableHost = el('div', 'table-host');
    frag.appendChild(tableHost);
    frag.appendChild(live());
    frag.appendChild(footer());
    return frag;
  }

  function render() {
    var hash = location.hash || '';
    var m = /^#\/p\/(.+)$/.exec(hash);
    var f = /^#\/cat\/(.+)$/.exec(hash);
    if (f) {
      state.cat = decodeURIComponent(f[1]);
      state.q = '';
      state.chain = 'all';
    } else if (!m) {
      state.cat = 'all';
    }
    clear(root);
    if (m) {
      root.appendChild(detail(decodeURIComponent(m[1])));
      window.scrollTo(0, 0);
    } else {
      root.appendChild(boardView());
      renderTable();
    }
  }

  window.addEventListener('hashchange', render);
  render();
})();
