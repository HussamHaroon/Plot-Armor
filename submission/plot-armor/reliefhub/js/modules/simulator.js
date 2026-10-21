/* MODULE: What-if Supply Simulator — OWNER: Eshaal (@Eshaal607)
 *
 * Rules from the issue:
 *  - Concept: model incoming aid before it arrives — sliders add hypothetical
 *    stock on top of current warehouse levels and every number on the page
 *    re-computes live, client-side. READ-ONLY: sliders never touch the API,
 *    works the same against the live API and in demo mode.
 *  - Controls: the six inventory items with the most outstanding need get a
 *    slider from 0 to 2x current outstanding (step 10) plus a Reset all ghost
 *    button and mono value chips.
 *  - Projection (pure function, attached to the module object):
 *      hypothetical stock = stock + slider delta
 *      projected fulfilment = min(required, fulfilled + allocated)
 *    where each item's incoming units are handed out GREEDILY to that item's
 *    unmet needs — ordered by priority (High > Medium > Low), then by
 *    remaining units, then id — until the pool runs dry. All sliders at 0
 *    must project today exactly: the pool starts empty, so nothing moves.
 *  - Scoring is self-contained (no import from the priority module other
 *    teammates are building) — same spirit: urgency High=1 / Medium=0.6 /
 *    Low=0.3, deprivation = 1 − fulfilment%, camp pressure = families /
 *    capacity.
 *  - Outputs: overall fulfilment now → projected with a green delta badge,
 *    top movers, camps that improve, a "still unrecoverable" note for High
 *    needs that stay under 40% even with the inflow, and a before/after
 *    Chart.js chart (fulfilment % by category, emerald = now, mint = after).
 *    Chart.js is optional — guarded with if (window.Chart).
 *
 * Available helpers: API.list(...), UI.h/badge/pct, App.registerModule.
 * Scroll reveal: App.render observes .reveal nodes on its own — I only tag
 * sections with the class and the house easing/stagger applies.
 */
(function () {
  /* Scoped styles for this module only (styles.css is the lead's file — I
   * don't touch it; teammates inject their own sheets the same way). */
  if (typeof document !== 'undefined' && !document.getElementById('simulator-css')) {
    const style = document.createElement('style');
    style.id = 'simulator-css';
    style.textContent = `
      /* ---- concept banner ---- */
      .sim-hero {
        display: flex; align-items: center; gap: var(--sp-4);
        padding: var(--sp-5) var(--sp-6); margin-bottom: var(--sp-5);
        border-radius: var(--r-lg); color: #eafff5;
        background:
          radial-gradient(600px 200px at 90% -40%, rgba(52, 211, 153, .35), transparent 60%),
          linear-gradient(120deg, var(--brand-deep), var(--brand));
        box-shadow: var(--shadow-md);
      }
      .sim-hero h3 { margin: 0 0 2px; font-size: var(--fs-md); color: #fff; }
      .sim-hero p { margin: 0; font-size: var(--fs-sm); color: var(--brand-200); }
      .sim-hero-ico {
        flex: none; width: 42px; height: 42px; border-radius: var(--r-md);
        display: grid; place-items: center; color: var(--brand-300);
        background: rgba(255, 255, 255, .08); border: 1px solid rgba(110, 231, 183, .35);
      }
      .sim-hero-ico svg { width: 22px; height: 22px; }

      /* ---- slider controls ---- */
      .sim-controls-head { display: flex; align-items: baseline; gap: var(--sp-3); margin-bottom: var(--sp-4); }
      .sim-controls-head h3 { margin: 0; font-size: var(--fs-md); font-weight: 700; }
      .sim-controls-head .btn { margin-left: auto; }
      .sim-slider-row {
        display: grid; grid-template-columns: minmax(180px, 1.1fr) 2fr auto;
        gap: var(--sp-4); align-items: center;
        padding: var(--sp-3) 0; border-top: 1px solid var(--line);
      }
      .sim-slider-name { display: block; font-weight: 600; font-size: var(--fs-sm); }
      .sim-slider-sub { display: block; font-size: var(--fs-xs); color: var(--muted); margin-top: 1px; }
      .sim-slider-row input[type="range"] { width: 100%; accent-color: var(--brand-strong); cursor: pointer; }
      .sim-chip {
        font-family: ui-monospace, 'Cascadia Mono', Consolas, 'Courier New', monospace;
        font-size: var(--fs-xs); font-weight: 600; min-width: 74px; text-align: center;
        padding: 3px 10px; border-radius: var(--r-pill);
        background: var(--panel-tint); border: 1px solid var(--line); color: var(--muted);
        transition: background var(--dur-2) var(--ease), color var(--dur-2) var(--ease),
                    border-color var(--dur-2) var(--ease);
      }
      .sim-chip-active { background: var(--ok-soft); border-color: var(--brand-300); color: var(--ok); }

      /* ---- KPI flow cards ---- */
      .sim-flow { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
      .sim-flow .sim-to { color: var(--brand-strong); }
      .sim-flow .sim-arrow { color: var(--faint); font-size: .6em; }
      .sim-flow .card-value { font-size: inherit; }
      .sim-kpi-badge { display: inline-flex; margin-top: 6px; }

      /* ---- two-column analytics ---- */
      .sim-grid2 { display: grid; grid-template-columns: 1.25fr 1fr; gap: var(--sp-4); margin-bottom: var(--sp-4); }
      .sim-row { padding: var(--sp-2) 0; border-top: 1px solid var(--line); }
      .sim-row:first-child { border-top: 0; }
      .sim-row-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
      .sim-row-title { font-weight: 600; font-size: var(--fs-sm); }
      .sim-row-sub { font-size: var(--fs-xs); color: var(--muted); margin-left: auto; font-family: ui-monospace, 'Cascadia Mono', Consolas, 'Courier New', monospace; }
      .sim-loc { color: var(--muted); font-weight: 500; font-size: var(--fs-xs); }
      .sim-track { display: flex; height: 8px; border-radius: var(--r-pill); overflow: hidden; background: var(--line); }
      .sim-track-now { background: var(--brand); height: 100%; }
      .sim-track-gain { background: var(--brand-400); height: 100%; transition: width var(--dur-2) var(--ease); }
      .sim-pts {
        font-family: ui-monospace, 'Cascadia Mono', Consolas, 'Courier New', monospace;
        font-size: var(--fs-xs); font-weight: 700; margin-left: 8px; white-space: nowrap;
      }
      .sim-pts-up { color: var(--ok); }
      .sim-pts-flat { color: var(--faint); font-weight: 600; }
      .sim-note {
        margin-top: var(--sp-3); padding: var(--sp-3) var(--sp-4);
        border-radius: var(--r-sm); background: var(--warn-soft); color: var(--warn);
        font-size: var(--fs-sm); border: 1px solid #fde68a;
      }
      .sim-hint { font-size: var(--fs-sm); color: var(--muted); padding: var(--sp-2) 0; }

      @media (max-width: 980px) {
        .sim-grid2 { grid-template-columns: 1fr; }
        .sim-slider-row { grid-template-columns: 1fr; gap: var(--sp-2); }
        .sim-chip { justify-self: start; }
      }
    `;
    document.head.append(style);
  }
})();

/* --------------------------------------------------------------------------
 * Pure projection math — no DOM, no API. Kept on the module object below so
 * it can be unit-tested straight from node against the seed data.
 *
 * projectScenario(needs, inventory, deltas) where deltas = { [itemId]: units }
 * returns per-need + per-item + camp/category/overall aggregates, now vs
 * projected. With every delta 0 the projection equals today, by construction.
 * ------------------------------------------------------------------------ */
function projectScenario(needs, inventory, deltas) {
  /* urgency weight per priority — higher is served first */
  const PRIORITY_WEIGHT = { High: 1, Medium: 0.6, Low: 0.3 };
  const incoming = id => Math.max(0, Math.round(+(deltas && deltas[id]) || 0));
  const pool = {};
  for (const it of inventory) pool[it.id] = incoming(it.id);

  /* Greedy order: most urgent first (High 1.0 > Medium 0.6 > Low 0.3), then
   * the biggest remaining gap, then lower id — so the scarce incoming units
   * land on the loudest needs first and the result never depends on the
   * order the API happened to return rows in. */
  const rows = needs.map(n => {
    const required = +n.required_quantity || 0;
    const fulfilled = +n.fulfilled_quantity || 0;
    return {
      n, required, fulfilled,
      remaining: Math.max(0, required - fulfilled),
      weight: PRIORITY_WEIGHT[n.priority] ?? 0.3,
    };
  }).sort((a, b) =>
    b.weight - a.weight || b.remaining - a.remaining || a.n.id - b.n.id);

  const perNeed = [];
  const allocatedByItem = {};
  for (const { n, required, fulfilled, remaining } of rows) {
    const itemId = n.inventory_item_id;
    const take = Math.min(remaining, pool[itemId] || 0);
    if (take > 0) {
      pool[itemId] -= take;
      allocatedByItem[itemId] = (allocatedByItem[itemId] || 0) + take;
    }
    const projected = Math.min(required, fulfilled + take);
    perNeed.push({
      id: n.id, camp_id: n.camp_id, inventory_item_id: itemId, priority: n.priority,
      required, fulfilled, allocated: take, projectedFulfilled: projected,
      currentPct: required ? Math.round((fulfilled / required) * 100) : 0,
      projectedPct: required ? Math.round((projected / required) * 100) : 0,
    });
  }
  for (const p of perNeed) p.gainPts = p.projectedPct - p.currentPct;

  const sumReq = perNeed.reduce((s, p) => s + p.required, 0);
  const sumNow = perNeed.reduce((s, p) => s + p.fulfilled, 0);
  const sumProj = perNeed.reduce((s, p) => s + p.projectedFulfilled, 0);
  const pct = (f, r) => (r ? Math.round((f / r) * 100) : 0);

  const items = {};
  for (const it of inventory) {
    const delta = incoming(it.id);
    const outstanding = perNeed
      .filter(p => p.inventory_item_id === it.id)
      .reduce((s, p) => s + Math.max(0, p.required - p.fulfilled), 0);
    items[it.id] = {
      id: it.id, name: it.name, category: it.category, unit: it.unit || '',
      stock: +it.stock || 0, delta, outstanding,
      hypothetical: (+it.stock || 0) + delta,
      allocated: allocatedByItem[it.id] || 0,
    };
  }

  /* top movers: the needs whose fulfilment % improves most */
  const topMovers = perNeed
    .filter(p => p.gainPts > 0)
    .sort((a, b) => b.gainPts - a.gainPts || b.allocated - a.allocated || a.id - b.id)
    .slice(0, 5);

  /* still unrecoverable: High-priority needs that stay under the dashboard's
   * 40% critical threshold even after the hypothetical inflow */
  const uncoveredHigh = perNeed
    .filter(p => p.priority === 'High' && p.projectedPct < 40)
    .sort((a, b) => a.projectedPct - b.projectedPct || a.id - b.id);

  /* camp level: average fulfilment across a camp's needs, now vs projected */
  const campAgg = {};
  for (const p of perNeed) {
    const c = (campAgg[p.camp_id] = campAgg[p.camp_id] || { now: [], projected: [] });
    c.now.push(p.currentPct);
    c.projected.push(p.projectedPct);
  }
  const avg = a => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  const camps = Object.entries(campAgg).map(([campId, agg]) => ({
    camp_id: +campId, needs: agg.now.length,
    nowAvg: avg(agg.now), projAvg: avg(agg.projected),
    gainPts: avg(agg.projected) - avg(agg.now),
  })).sort((a, b) => b.gainPts - a.gainPts || a.camp_id - b.camp_id);

  /* category level (for the before/after chart): average fulfilment % */
  const itemById = Object.fromEntries(inventory.map(i => [i.id, i]));
  const catAgg = {};
  for (const p of perNeed) {
    const cat = (itemById[p.inventory_item_id] || {}).category || 'Other';
    const c = (catAgg[cat] = catAgg[cat] || { now: [], projected: [] });
    c.now.push(p.currentPct);
    c.projected.push(p.projectedPct);
  }
  const byCategory = {};
  for (const [cat, agg] of Object.entries(catAgg)) {
    byCategory[cat] = { now: avg(agg.now), projected: avg(agg.projected) };
  }

  return {
    perNeed, items, topMovers, uncoveredHigh, camps, byCategory,
    overallNow: pct(sumNow, sumReq),
    overallProjected: pct(sumProj, sumReq),
    overallDelta: pct(sumProj, sumReq) - pct(sumNow, sumReq),
    unmetNow: Math.max(0, sumReq - sumNow),
    unmetProjected: Math.max(0, sumReq - sumProj),
  };
}

const simulator = {
  id: 'simulator', title: 'What-if Simulator', icon: '🧮', order: 9,
  subtitle: 'Model incoming aid and see which camps your next truck helps most',
  projectScenario, /* pure math lives here for reuse + node testing */

  async render() {
    const [camps, inventory, needs] = await Promise.all([
      API.list('camps'), API.list('inventory'), API.list('needs'),
    ]);
    const campById = Object.fromEntries(camps.map(c => [c.id, c]));
    const itemById = Object.fromEntries(inventory.map(i => [i.id, i]));
    const root = UI.h('div');

    /* Empty state — nothing to model */
    if (!needs.length || !inventory.length) {
      root.append(UI.h('div', { class: 'empty' }, [
        UI.h('div', { class: 'empty-art', 'aria-hidden': 'true' }),
        UI.h('p', { class: 'empty-text' },
          needs.length ? 'No inventory items recorded yet — nothing to model.' :
            'No needs recorded yet — nothing to simulate.'),
      ]));
      return root;
    }

    /* The six items with the most outstanding need across all camps. */
    const baseline = simulator.projectScenario(needs, inventory, {});
    const sliderItems = Object.values(baseline.items)
      .filter(it => it.outstanding > 0)
      .sort((a, b) => b.outstanding - a.outstanding || a.id - b.id)
      .slice(0, 6);

    const deltas = {}; /* itemId -> incoming units (0 = today) */
    sliderItems.forEach(it => { deltas[it.id] = 0; });

    /* ---- 1. Concept banner ---- */
    root.append(UI.h('section', { class: 'sim-hero reveal' }, [
      UI.h('span', { class: 'sim-hero-ico', 'aria-hidden': 'true' }, [
        (() => {
          const s = document.createElement('span');
          s.innerHTML = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='1' y='3' width='15' height='13' rx='1'/><path d='M16 8h4l3 3v5h-7V8z'/><circle cx='5.5' cy='18.5' r='2.5'/><circle cx='18.5' cy='18.5' r='2.5'/></svg>";
          return s;
        })(),
      ]),
      UI.h('div', {}, [
        UI.h('h3', {}, 'What-if mode — read-only'),
        UI.h('p', {}, 'Model incoming aid before it arrives — see which camps your next truck helps most.'),
      ]),
    ]));

    /* ---- 2. Controls: one slider per top-need item ---- */
    const controlsPanel = UI.h('section', { class: 'panel reveal', style: '--d:60ms' }, [
      UI.h('div', { class: 'sim-controls-head' }, [
        UI.h('h3', {}, 'Incoming stock — drag to model your next truck'),
        UI.h('button', {
          class: 'btn btn-ghost',
          onclick: () => {
            for (const it of sliderItems) deltas[it.id] = 0;
            sliderItems.forEach(it => {
              const input = root.querySelector('input[data-item="' + it.id + '"]');
              const chip = root.querySelector('.sim-chip[data-chip="' + it.id + '"]');
              if (input) input.value = 0;
              if (chip) { chip.textContent = '0'; chip.classList.remove('sim-chip-active'); }
            });
            recompute();
          },
        }, 'Reset all'),
      ]),
    ]);
    for (const it of sliderItems) {
      const max = Math.max(10, Math.ceil((it.outstanding * 2) / 10) * 10);
      const chip = UI.h('span', { class: 'sim-chip', 'data-chip': String(it.id) }, '0');
      controlsPanel.append(UI.h('div', { class: 'sim-slider-row' }, [
        UI.h('span', { class: 'sim-slider-meta' }, [
          UI.h('span', { class: 'sim-slider-name' }, it.name),
          UI.h('span', { class: 'sim-slider-sub' },
            'outstanding ' + it.outstanding.toLocaleString() + ' ' + it.unit +
            ' · slider up to ' + max.toLocaleString()),
        ]),
        UI.h('input', {
          type: 'range', min: 0, max, step: 10, value: 0,
          'data-item': String(it.id),
          'aria-label': 'Incoming ' + it.name + ' (units)',
          oninput: e => {
            deltas[it.id] = +e.target.value;
            chip.textContent = deltas[it.id] ? '+' + deltas[it.id].toLocaleString() : '0';
            chip.classList.toggle('sim-chip-active', deltas[it.id] > 0);
            schedule();
          },
        }),
        chip,
      ]));
    }
    root.append(controlsPanel);

    /* ---- 3. KPI row: now → projected ---- */
    const kpiValue = UI.h('div', { class: 'card-value sim-flow' }, []);
    const kpiBadge = UI.h('span', { class: 'sim-kpi-badge' }, []);
    const unmetValue = UI.h('div', { class: 'card-value sim-flow' }, []);
    const unmetBadge = UI.h('span', { class: 'sim-kpi-badge' }, []);
    root.append(UI.h('div', { class: 'cards reveal', style: '--d:120ms' }, [
      UI.h('div', { class: 'card' }, [
        UI.h('div', { class: 'card-label' }, 'Overall Fulfilment'),
        kpiValue,
        UI.h('div', { class: 'card-sub' }, [kpiBadge]),
      ]),
      UI.h('div', { class: 'card' }, [
        UI.h('div', { class: 'card-label' }, 'Unmet Units'),
        unmetValue,
        UI.h('div', { class: 'card-sub' }, [unmetBadge]),
      ]),
    ]));

    /* flow helper: "47% → 61%" with the projected side highlighted */
    function flow(el, nowTxt, projTxt) {
      el.innerHTML = '';
      el.append(
        document.createTextNode(nowTxt),
        UI.h('span', { class: 'sim-arrow' }, ' → '),
        UI.h('span', { class: 'sim-to' }, projTxt),
      );
    }

    /* ---- 4. Top movers + camps that improve ---- */
    const moversList = UI.h('div', {}, []);
    const simNote = UI.h('div', { class: 'sim-note', hidden: true }, []);
    const campsList = UI.h('div', {}, []);
    root.append(UI.h('div', { class: 'sim-grid2' }, [
      UI.h('section', { class: 'panel reveal', style: '--d:180ms' }, [
        UI.h('h3', {}, 'Top movers — needs that improve most'),
        moversList,
        simNote,
      ]),
      UI.h('section', { class: 'panel reveal', style: '--d:220ms' }, [
        UI.h('h3', {}, 'Camps that improve'),
        UI.h('p', { class: 'sim-hint' },
          'Average fulfilment across each camp\u2019s needs. Pressure = families \u00f7 capacity.'),
        campsList,
      ]),
    ]));

    /* One comparison row: emerald = fulfilment now, mint = the projected gain. */
    function barRow(title, loc, tag, nowPct, projPct, gain) {
      const now = Math.min(nowPct, 100);
      const pts = UI.h('span', { class: 'sim-pts ' + (gain > 0 ? 'sim-pts-up' : 'sim-pts-flat') },
        (gain > 0 ? '+' : '\u00b1') + gain + ' pts');
      return UI.h('div', { class: 'sim-row' }, [
        UI.h('div', { class: 'sim-row-meta' }, [
          UI.h('span', { class: 'sim-row-title' }, title),
          loc ? UI.h('span', { class: 'sim-loc' }, loc) : null,
          tag || null,
          UI.h('span', { class: 'sim-row-sub' }, nowPct + '% \u2192 ' + projPct + '%'),
          pts,
        ]),
        UI.h('div', { class: 'sim-track', role: 'img', 'aria-label': title + ': ' + nowPct + '% now, projected ' + projPct + '%' }, [
          UI.h('div', { class: 'sim-track-now', style: 'width:' + now + '%' }),
          UI.h('div', { class: 'sim-track-gain', style: 'width:' + Math.max(0, Math.min(gain, 100 - now)) + '%' }),
        ]),
      ]);
    }

    function renderMovers(res) {
      moversList.innerHTML = '';
      if (!res.topMovers.length) {
        moversList.append(UI.h('p', { class: 'sim-hint' },
          'No change yet \u2014 pull a slider up to add incoming stock.'));
        return;
      }
      for (const p of res.topMovers) {
        moversList.append(barRow(
          (itemById[p.inventory_item_id] || {}).name || 'Supplies',
          'at ' + ((campById[p.camp_id] || {}).name || 'Camp ' + p.camp_id),
          UI.priorityBadge(p.priority),
          p.currentPct, p.projectedPct, p.gainPts));
      }
    }

    function renderCamps(res) {
      campsList.innerHTML = '';
      if (!res.camps.length) {
        campsList.append(UI.h('p', { class: 'sim-hint' }, 'No camps with open needs.'));
        return;
      }
      for (const c of res.camps) {
        const camp = campById[c.camp_id] || {};
        const pressure = camp.capacity ? Math.round((+camp.current_families || 0) / +camp.capacity * 100) : null;
        campsList.append(barRow(
          camp.name || 'Camp ' + c.camp_id,
          c.needs + (c.needs === 1 ? ' need' : ' needs'),
          pressure != null ? UI.badge('pressure ' + pressure + '%', pressure >= 90 ? 'warn' : 'muted') : null,
          c.nowAvg, c.projAvg, c.gainPts));
      }
    }

    function renderNote(res) {
      const uh = res.uncoveredHigh;
      if (!uh.length) { simNote.hidden = true; simNote.textContent = ''; return; }
      const names = uh.slice(0, 3).map(p =>
        ((itemById[p.inventory_item_id] || {}).name || 'Supplies') + ' at ' +
        ((campById[p.camp_id] || {}).name || 'Camp ' + p.camp_id) + ' (' + p.projectedPct + '%)');
      simNote.textContent = 'Even with this inflow, ' + uh.length + ' high-priority need' +
        (uh.length > 1 ? 's' : '') + ' stay' + (uh.length > 1 ? '' : 's') +
        ' under 40% \u2014 stock alone can\u2019t close ' + (uh.length > 1 ? 'them' : 'it') +
        ': ' + names.join(', ') + '.';
      simNote.hidden = false;
    }

    /* ---- 5. Before/after chart: fulfilment % by category ---- */
    const cats = Object.keys(baseline.byCategory).sort();
    const chartBox = UI.h('section', { class: 'chart-box reveal', style: '--d:260ms' }, [
      UI.h('h3', {}, 'Fulfilment % by category \u2014 current vs projected'),
      UI.h('canvas', { height: '220', role: 'img', 'aria-label': 'Fulfilment by category, current versus projected' }),
    ]);
    root.append(chartBox);
    const canvas = chartBox.querySelector('canvas');
    let chart = null;
    let lastRes = null;
    function ensureChart() {
      if (!window.Chart || chart || !canvas) return;
      const res = lastRes || baseline;
      chart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: cats,
          datasets: [
            { label: 'Current', data: cats.map(c => res.byCategory[c].now),
              backgroundColor: '#0d5c46', borderRadius: 6 },
            { label: 'Projected', data: cats.map(c => res.byCategory[c].projected),
              backgroundColor: '#34d399', borderRadius: 6 },
          ],
        },
        options: {
          scales: { y: { beginAtZero: true, max: 100 } },
          plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } },
        },
      });
    }
    setTimeout(ensureChart, 0);

    /* ---- recompute: pure math + DOM diff, debounced ~100ms ---- */
    function recompute() {
      const res = simulator.projectScenario(needs, inventory, deltas);
      lastRes = res;

      flow(kpiValue, res.overallNow + '%', res.overallProjected + '%');
      kpiBadge.innerHTML = '';
      kpiBadge.append(UI.badge(
        (res.overallDelta > 0 ? '+' : '') + res.overallDelta + ' pts vs now',
        res.overallDelta > 0 ? 'ok' : 'muted'));
      flow(unmetValue, res.unmetNow.toLocaleString(), res.unmetProjected.toLocaleString());
      unmetBadge.innerHTML = '';
      const saved = res.unmetNow - res.unmetProjected;
      unmetBadge.append(UI.badge(
        (saved > 0 ? '\u2212' : '') + saved.toLocaleString() + ' units covered',
        saved > 0 ? 'ok' : 'muted'));

      renderMovers(res);
      renderCamps(res);
      renderNote(res);

      if (chart) {
        chart.data.datasets[1].data = cats.map(c => res.byCategory[c].projected);
        chart.update('none'); /* instant — it must keep up with the sliders */
      }
    }

    let timer = null;
    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(recompute, 100);
    }
    recompute(); /* first paint with all sliders at 0 */

    return root;
  },
};

App.registerModule(simulator);
