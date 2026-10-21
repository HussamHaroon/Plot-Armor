/* MODULE: Dispatch Intelligence — OWNER: Eshaal (@Eshaal607)
 *
 * Explainable "what do we dispatch next" ranking. Every open need gets a
 * transparent 0-100 dispatch score from four weighted signals — the same
 * weighted multi-signal triage approach as the team's label-priority model
 * (98.5% review yield), applied to relief dispatching:
 *   urgency     — need priority: High 1.0 / Medium 0.6 / Low 0.3
 *   deprivation — 1 − fulfilment % (UI.pct)
 *   pressure    — camp current_families ÷ capacity
 *   stock cover — min(1, warehouse stock ÷ remaining need); zero stock is
 *                 flagged "uncoverable" instead of silently ranking top
 * Read-only by design: this module never mutates anything (the only
 * convenience is a coordinator clipboard copy of the top 5), so it behaves
 * identically against the live Render API and the bundled demo data
 * (api.js demo-mode fallback). Self-registering via App.registerModule —
 * safe to load last.
 */
App.registerModule({
  id: 'priority', title: 'Dispatch Intelligence', icon: '🧠', order: 7,
  subtitle: 'What to dispatch next, and why',

  /* Signal weights (sum to 1). Kept on the module so the UI chips that show
   * them and the score itself can never drift apart. */
  weights: { urgency: 0.35, deprivation: 0.30, pressure: 0.20, stock: 0.15 },
  URGENCY: { High: 1.0, Medium: 0.6, Low: 0.3 },

  clamp01(v) { return Math.max(0, Math.min(1, v)); },

  /* Pure signal computation — no DOM, so a node harness can exercise it. */
  signals(need, camp, item) {
    const required = +need.required_quantity || 0;
    const fulfilled = +need.fulfilled_quantity || 0;
    const remaining = Math.max(0, required - fulfilled);
    const fulfilPct = UI.pct(fulfilled, required);
    const stock = +((item || {}).stock) || 0;
    return {
      urgency: this.clamp01(this.URGENCY[need.priority] ?? 0.5),
      deprivation: this.clamp01(1 - fulfilPct / 100),
      pressure: this.clamp01(camp && +camp.capacity ? (+camp.current_families || 0) / +camp.capacity : 0),
      stock: remaining > 0 ? this.clamp01(stock / remaining) : 0,
      /* passthroughs the UI needs alongside the four 0-1 signals */
      remaining, fulfilPct, stockOnHand: stock,
    };
  },

  /* Weighted sum ×100 → 0-100 dispatch score. */
  score(need, camp, item) {
    const s = this.signals(need, camp, item);
    const w = this.weights;
    return Math.round((s.urgency * w.urgency + s.deprivation * w.deprivation
      + s.pressure * w.pressure + s.stock * w.stock) * 100);
  },

  /* One-line "why", generated from the two heaviest signals (signal × weight),
   * e.g. "High priority need, only 25% fulfilled at Badin Central Camp." */
  whyFor(r) {
    const w = this.weights, s = r.sig;
    const phrases = {
      urgency: r.need.priority + ' priority need',
      deprivation: 'only ' + s.fulfilPct + '% fulfilled',
      pressure: 'camp at ' + Math.round(s.pressure * 100) + '% capacity',
      stock: s.stock >= 1 ? 'warehouse stock covers the whole gap'
        : s.stock <= 0 ? 'no stock in the warehouse'
          : 'warehouse covers ' + Math.round(s.stock * 100) + '% of the gap',
    };
    const top2 = ['urgency', 'deprivation', 'pressure', 'stock']
      .sort((a, b) => s[b] * w[b] - s[a] * w[a]).slice(0, 2);
    const sentence = top2.map(k => phrases[k]).join(', ');
    const campName = (r.camp || {}).name || 'camp #' + r.need.camp_id;
    return sentence.charAt(0).toUpperCase() + sentence.slice(1) + ' at ' + campName + '.';
  },

  async render() {
    const [camps, items, needs] = await Promise.all([
      API.list('camps'), API.list('inventory'), API.list('needs'),
    ]);
    const campById = Object.fromEntries(camps.map(c => [c.id, c]));
    const itemById = Object.fromEntries(items.map(i => [i.id, i]));
    const root = UI.h('div');

    /* Filter state — the table body refreshes live, exactly like needs.js. */
    let campFilter = 'All';
    let priorityFilter = 'All';
    const tableBox = UI.h('div');
    const countNote = UI.h('span', { class: 'toolbar-note' });

    /* Rank only needs that still need supplies; fully fulfilled ones have
     * nothing to dispatch, so they are excluded (and counted in the note). */
    const openNeeds = needs.filter(n => Math.max(0, +n.required_quantity - +n.fulfilled_quantity) > 0);
    const excluded = needs.length - openNeeds.length;

    function matches(n) {
      if (campFilter !== 'All' && String(n.camp_id) !== campFilter) return false;
      if (priorityFilter !== 'All' && n.priority !== priorityFilter) return false;
      return true;
    }

    /* Build ranked rows: score desc, then biggest remaining gap first. */
    const rankedRows = () => openNeeds.filter(matches)
      .map(n => {
        const camp = campById[n.camp_id] || null;
        const item = itemById[n.inventory_item_id] || null;
        return { need: n, camp, item, sig: this.signals(n, camp, item), score: this.score(n, camp, item) };
      })
      .sort((a, b) => b.score - a.score || b.sig.remaining - a.sig.remaining);

    const refresh = () => {
      const rows = rankedRows();
      countNote.textContent = rows.length + ' open needs ranked'
        + (excluded ? ' · ' + excluded + ' fully fulfilled excluded' : '');
      rows.forEach((r, i) => { r.rank = i + 1; });
      tableBox.innerHTML = '';
      const table = UI.table(buildColumns(), rows,
        openNeeds.length ? 'No needs match your filters.' : 'No open needs to rank right now.');
      /* top 3 dispatches get a subtle brand accent so the eye lands there first */
      table.querySelectorAll('tbody tr').forEach((tr, i) => {
        if (i < 3) {
          tr.style.background = 'var(--brand-soft)';
          tr.style.boxShadow = 'inset 3px 0 0 var(--brand)';
        }
      });
      tableBox.append(table);
    };

    /* Four tiny labelled progress bars — one per signal, 0-100 scaled, with a
     * small mono readout. Color mirrors the semantic scale used elsewhere. */
    function signalCell(r) {
      const s = r.sig;
      const defs = [
        ['URG', s.urgency, s.urgency >= 1 ? 'var(--bad)' : s.urgency >= 0.6 ? 'var(--warn)' : 'var(--ok)'],
        ['DEP', s.deprivation, s.deprivation >= 0.75 ? 'var(--bad)' : s.deprivation >= 0.5 ? 'var(--warn)' : 'var(--info)'],
        ['PRES', s.pressure, s.pressure >= 0.9 ? 'var(--bad)' : s.pressure >= 0.6 ? 'var(--warn)' : 'var(--info)'],
        ['STOCK', s.stock, s.stock >= 1 ? 'var(--ok)' : s.stock > 0 ? 'var(--warn)' : 'var(--bad)'],
      ];
      return UI.h('div', {
        style: 'display:grid;grid-template-columns:46px 66px 32px;gap:3px 6px;align-items:center;'
          + 'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:var(--fs-2xs);color:var(--muted);',
      }, defs.flatMap(([label, v, color]) => [
        UI.h('span', {}, label),
        UI.h('div', { class: 'progress', style: 'width:66px;height:6px;' },
          UI.h('div', { style: 'width:' + Math.round(v * 100) + '%;background:' + color })),
        UI.h('span', { style: 'text-align:right;font-variant-numeric:tabular-nums;' }, String(Math.round(v * 100))),
      ]));
    }

    const buildColumns = () => [
        { label: '#', render: r => UI.h('span', {
          style: r.rank <= 3 ? 'font-weight:700;color:var(--brand-deep);' : '',
        }, '#' + r.rank) },
        { label: 'Camp', render: r => (r.camp || {}).name || 'Camp #' + r.need.camp_id },
        { label: 'Item', render: r => {
          const name = (r.item || {}).name || 'Item #' + r.need.inventory_item_id;
          /* a high score with nothing on the shelf must be visible, not silent */
          const flag = r.sig.stockOnHand <= 0 ? UI.badge('uncoverable', 'bad')
            : r.sig.stock < 1 ? UI.badge('partial cover', 'warn') : null;
          return UI.h('span', { style: 'display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;' },
            [name, flag]);
        } },
        { label: 'Remaining', render: r => UI.h('span', { class: 'need-progress' },
          r.sig.remaining.toLocaleString() + ((r.item || {}).unit ? ' ' + r.item.unit : '')) },
        { label: 'Signals', render: signalCell },
        { label: 'Score', render: r => UI.badge(r.score + '/100',
          r.score >= 75 ? 'bad' : r.score >= 50 ? 'warn' : 'info') },
        { label: 'Why', render: r => UI.h('span', { class: 'muted', style: 'font-size:var(--fs-xs);' },
          this.whyFor(r)) },
      ];

    /* Explainer banner — the method behind the ranking, in one sentence. */
    root.append(UI.h('div', {
      class: 'panel',
      style: 'background:var(--brand-soft);border-left:4px solid var(--brand);margin-bottom:var(--sp-4);',
    }, [
      UI.h('strong', { style: 'color:var(--brand-deep);' }, 'How this ranks: '),
      "the same weighted multi-signal triage approach as the team's label-priority model "
        + '(98.5% review yield) — four transparent signals per need combine into one 0-100 '
        + 'dispatch score, and every row shows its why.',
    ]));

    /* Weight chips row — the formula is part of the UI, not a secret. */
    const w = this.weights;
    root.append(UI.h('div', { class: 'toolbar' }, [
      UI.h('span', { class: 'toolbar-note' }, 'Dispatch score ='),
      ['urgency', 'deprivation', 'pressure', 'stock'].map(k =>
        UI.h('span', {
          style: 'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:var(--fs-2xs);'
            + 'border:1px solid var(--line-strong);background:var(--panel-tint);'
            + 'border-radius:var(--r-pill);padding:2px 8px;',
        }, k.toUpperCase() + ' ×' + w[k])),
    ]));

    /* Coordinator-only convenience: copy the top 5 dispatch list to the
     * clipboard. Read-only module otherwise — this never touches the API,
     * so it behaves the same in live and demo mode. */
    const canEdit = App.canEdit();
    const copyTop5 = canEdit ? UI.h('button', {
      class: 'btn btn-sm btn-ghost',
      onclick: () => {
        const lines = rankedRows().slice(0, 5).map(r =>
          '#' + r.rank + ' · ' + r.score + '/100 · ' + ((r.camp || {}).name || '')
          + ' · ' + ((r.item || {}).name || '') + ' · ' + this.whyFor(r));
        try {
          navigator.clipboard.writeText(lines.join('\n')).then(
            () => UI.toast('Top 5 dispatches copied to clipboard', 'success'),
            () => UI.toast('Could not copy to clipboard', 'error'));
        } catch (err) {
          UI.toast('Could not copy to clipboard', 'error');
        }
      },
    }, 'Copy top 5') : null;

    root.append(UI.h('div', { class: 'toolbar' }, [
      UI.h('select', { onchange: e => { campFilter = e.target.value; refresh(); } },
        [UI.h('option', { value: 'All' }, 'All camps'),
          ...camps.map(c => UI.h('option', { value: String(c.id) }, c.name))]),
      UI.h('select', { onchange: e => { priorityFilter = e.target.value; refresh(); } },
        [UI.h('option', { value: 'All' }, 'All priorities'),
          ...['High', 'Medium', 'Low'].map(p => UI.h('option', { value: p }, p))]),
      countNote,
      copyTop5,
    ]));

    root.append(tableBox);
    refresh();

    /* Score distribution by camp — average dispatch score across each camp's
     * open needs (unfiltered overview). Horizontal bars, worst camp at the
     * top. Rendered only when Chart.js is actually available, exactly like
     * the dashboard does. */
    if (openNeeds.length) {
      const acc = {};
      for (const r of rankedRows()) {
        const name = (r.camp || {}).name || 'Camp #' + r.need.camp_id;
        (acc[name] = acc[name] || []).push(r.score);
      }
      const byCamp = Object.entries(acc)
        .map(([name, scores]) => ({ name, avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) }))
        .sort((a, b) => b.avg - a.avg);

      const chartBox = UI.h('div', { class: 'chart-box' }, [
        UI.h('h3', {}, 'Average Dispatch Score by Camp'),
        UI.h('canvas', { height: '220' }),
      ]);
      root.append(chartBox);
      setTimeout(() => {
        if (typeof Chart === 'undefined') return;
        new Chart(chartBox.querySelector('canvas'), {
          type: 'bar',
          data: {
            labels: byCamp.map(c => c.name),
            datasets: [{
              label: 'Avg dispatch score',
              data: byCamp.map(c => c.avg),
              backgroundColor: '#0d5c46',
              borderRadius: 6,
            }],
          },
          options: {
            indexAxis: 'y',
            scales: { x: { beginAtZero: true, max: 100 } },
            plugins: { legend: { display: false } },
          },
        });
      }, 0);
    }

    return root;
  },
});
