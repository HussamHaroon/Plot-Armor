/* Milestone 5 — Dashboard & Critical Gaps. Owned by Team Lead (HussamHaroon). */
App.registerModule({
  id: 'dashboard', title: 'Dashboard', icon: '📊', order: 0,
  subtitle: 'Live overview of camps, supplies and critical gaps',
  async render() {
    const [camps, inventory, needs, volunteers] = await Promise.all([
      API.list('camps'), API.list('inventory'), API.list('needs'), API.list('volunteers'),
    ]);
    const campById = Object.fromEntries(camps.map(c => [c.id, c]));
    const itemById = Object.fromEntries(inventory.map(i => [i.id, i]));

    const activeCamps = camps.filter(c => c.status !== 'Closed');
    const families = activeCamps.reduce((s, c) => s + (+c.current_families || 0), 0);
    const reqTotal = needs.reduce((s, n) => s + +n.required_quantity, 0);
    const fulTotal = needs.reduce((s, n) => s + +n.fulfilled_quantity, 0);
    const overall = reqTotal ? Math.round((fulTotal / reqTotal) * 100) : 0;
    const lowStock = inventory.filter(i => +i.stock <= +i.reorder_level);
    const deployed = volunteers.filter(v => v.camp_id != null).length;

    const root = UI.h('div');

    const kpis = [
      ['Active Camps', String(activeCamps.length), camps.length + ' camps total'],
      ['Families Sheltered', families.toLocaleString(), 'in active camps'],
      ['Overall Fulfilment', overall + '%', fulTotal.toLocaleString() + ' of ' + reqTotal.toLocaleString() + ' units'],
      ['Low-Stock Items', String(lowStock.length), lowStock.length ? lowStock.map(i => i.name).join(', ') : 'everything stocked'],
      ['Volunteers Deployed', String(deployed), (volunteers.length - deployed) + ' available'],
    ];
    root.append(UI.h('div', { class: 'cards' }, kpis.map(([label, value, sub]) =>
      UI.h('div', { class: 'card' }, [
        UI.h('div', { class: 'card-label' }, label),
        UI.h('div', { class: 'card-value' }, value),
        UI.h('div', { class: 'card-sub' }, sub),
      ]))));

    /* Bar chart: fulfilment % by item category (needs joined to inventory). */
    const catAgg = {};
    for (const n of needs) {
      const cat = (itemById[n.inventory_item_id] || {}).category || 'Other';
      (catAgg[cat] = catAgg[cat] || []).push(UI.pct(+n.fulfilled_quantity, +n.required_quantity));
    }
    const cats = Object.keys(catAgg).sort();
    const chartBox = UI.h('div', { class: 'chart-box' }, [UI.h('h3', {}, 'Fulfilment % by Item Category')]);
    const canvas = UI.h('canvas', { height: '220' });
    chartBox.append(canvas);
    root.append(chartBox);

    /* Critical Gaps: High-priority needs under 40% fulfilment, worst gap first. */
    const gaps = needs
      .filter(n => n.priority === 'High' && UI.pct(+n.fulfilled_quantity, +n.required_quantity) < 40)
      .sort((a, b) => UI.pct(+a.fulfilled_quantity, +a.required_quantity) - UI.pct(+b.fulfilled_quantity, +b.required_quantity));
    root.append(UI.h('div', { class: 'panel' }, [
      UI.h('h3', {}, 'Critical Gaps — High-priority needs under 40% (' + gaps.length + ')'),
      UI.table([
        { label: 'Camp', render: n => UI.h('a', { href: '#/camps' }, (campById[n.camp_id] || {}).name || 'Camp ' + n.camp_id) },
        { label: 'Item', render: n => (itemById[n.inventory_item_id] || {}).name || '-' },
        { label: 'Required', render: n => (+n.required_quantity).toLocaleString() },
        { label: 'Fulfilled', render: n => (+n.fulfilled_quantity).toLocaleString() },
        { label: 'Fulfilment', render: n => {
          const p = UI.pct(+n.fulfilled_quantity, +n.required_quantity);
          return UI.badge(p + '%', p < 25 ? 'bad' : 'warn');
        } },
      ], gaps, 'No critical gaps right now.'),
    ]));

    setTimeout(() => {
      if (typeof Chart === 'undefined') return;
      new Chart(canvas, {
        type: 'bar',
        data: {
          labels: cats,
          datasets: [{
            label: 'Avg fulfilment %',
            data: cats.map(c => Math.round(catAgg[c].reduce((a, b) => a + b, 0) / catAgg[c].length)),
            backgroundColor: '#0d5c46',
            borderRadius: 6,
          }],
        },
        options: { scales: { y: { beginAtZero: true, max: 100 } }, plugins: { legend: { display: false } } },
      });
    }, 0);

    return root;
  },
});
