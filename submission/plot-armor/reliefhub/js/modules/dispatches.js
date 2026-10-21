/* MODULE: Dispatches & Stock Reservations (Milestone 3) — OWNER: Syeda Anusha Ali (@SyedaAnushaAli)
 *
 * Rules from the issue (this is the hardest module — the business rules matter):
 *  - Create a dispatch by choosing a camp, one of that camp's needs, and a quantity.
 *  - Reserve stock IMMEDIATELY on dispatch creation: model reservations by
 *    deducting the quantity from inventory stock (API.update('inventory', itemId,
 *    { stock: newStock })). "Available stock" therefore == current item stock.
 *  - NEVER dispatch more than available stock (validate before create).
 *  - NEVER exceed the need's remaining unreserved quantity:
 *      required_quantity − fulfilled_quantity − SUM(quantity of that need's
 *      dispatches with status Pending or In Transit)
 *    (validate before create).
 *  - Statuses and transitions: Pending → In Transit → Delivered; Cancel allowed
 *    from Pending or In Transit only.
 *      * Mark Delivered: increase the need's fulfilled_quantity by the dispatch
 *        quantity (API.update('needs', needId, {fulfilled_quantity: ...})).
 *      * Cancel (undelivered): restore the reserved stock (item.stock += quantity).
 *  - Status filter on the dispatch list (All/Pending/In Transit/Delivered/Cancelled).
 *  - Coordinator-only mutations (App.canEdit()); volunteers read-only.
 *
 * Helper: UI.statusBadge(status) already maps Pending=warn, In Transit=info,
 * Delivered=ok, Cancelled=muted.
 */
(() => {
  /* load my little stylesheet once (styles.css belongs to the team lead) */
  if (!document.getElementById('anusha-css')) {
    const link = document.createElement('link');
    link.id = 'anusha-css';
    link.rel = 'stylesheet';
    link.href = 'js/modules/anusha.css';
    document.head.append(link);
  }

  /* dispatches in these statuses hold a reservation on inventory stock */
  const ACTIVE = ['Pending', 'In Transit'];
  const FILTERS = ['All', 'Pending', 'In Transit', 'Delivered', 'Cancelled'];
  let statusFilter = 'All'; /* survives re-renders */

  /* required − fulfilled − (pending + in-transit dispatches for this need) */
  function remainingUnreserved(need, dispatches) {
    const reserved = dispatches
      .filter(d => d.need_id === need.id && ACTIVE.includes(d.status))
      .reduce((sum, d) => sum + (+d.quantity || 0), 0);
    return +need.required_quantity - (+need.fulfilled_quantity || 0) - reserved;
  }

  const mod = {
    id: 'dispatches', title: 'Dispatches', icon: '🚚', order: 4,
    subtitle: 'Stock reservations and deliveries to camps',

    async render() {
      const [camps, needs, inventory, dispatches] = await Promise.all([
        API.list('camps'), API.list('needs'), API.list('inventory'), API.list('dispatches'),
      ]);
      const campById = Object.fromEntries(camps.map(c => [c.id, c]));
      const needById = Object.fromEntries(needs.map(n => [n.id, n]));
      const itemById = Object.fromEntries(inventory.map(i => [i.id, i]));

      const root = UI.h('div');

      /* toolbar: status filter (with counts) + new dispatch for coordinators */
      const filterSelect = UI.h('select', { onchange: e => { statusFilter = e.target.value; App.render(); } },
        FILTERS.map(f => {
          const count = f === 'All' ? dispatches.length : dispatches.filter(d => d.status === f).length;
          const opt = UI.h('option', { value: f }, `${f} (${count})`);
          opt.selected = f === statusFilter;
          return opt;
        }));
      root.append(UI.h('div', { class: 'toolbar' }, [
        UI.h('span', { class: 'muted' }, 'Status'),
        filterSelect,
        App.canEdit()
          ? UI.h('button', { class: 'btn btn-primary', onclick: () => mod.openCreate() }, '+ New Dispatch')
          : null,
      ]));

      const rows = dispatches
        .filter(d => statusFilter === 'All' || d.status === statusFilter)
        .slice()
        .sort((a, b) => b.id - a.id);

      const columns = [
        { key: 'id', label: '#' },
        { label: 'Camp', render: d => (campById[d.camp_id] || {}).name || ('Camp ' + d.camp_id) },
        { label: 'Item', render: d => {
            const need = needById[d.need_id];
            const item = need && itemById[need.inventory_item_id];
            return item ? item.name : '—';
          } },
        { label: 'Quantity', render: d => (+d.quantity).toLocaleString() },
        { label: 'Status', render: d => UI.statusBadge(d.status) },
      ];
      if (App.canEdit()) {
        columns.push({ label: 'Actions', render: d => mod.actionButtons(d) });
      }

      root.append(UI.h('div', { class: 'panel' }, [
        UI.h('h3', {}, `Dispatches (${rows.length})`),
        UI.table(columns, rows, 'No dispatches match this filter yet.'),
      ]));

      return root;
    },

    actionButtons(d) {
      const wrap = UI.h('span', { class: 'row-actions' }, []);
      if (d.status === 'Pending') {
        wrap.append(UI.h('button', { class: 'btn btn-sm btn-primary', onclick: () => mod.setStatus(d, 'In Transit') }, 'Mark In Transit'));
      }
      if (d.status === 'In Transit') {
        wrap.append(UI.h('button', { class: 'btn btn-sm btn-primary', onclick: () => mod.markDelivered(d) }, 'Mark Delivered'));
      }
      if (ACTIVE.includes(d.status)) {
        wrap.append(UI.h('button', { class: 'btn btn-sm btn-danger', onclick: () => mod.cancel(d) }, 'Cancel'));
      }
      if (!wrap.childNodes.length) wrap.append(UI.h('span', { class: 'muted' }, '—'));
      return wrap;
    },

    /* ---------- create: camp → need → qty, reserve stock on submit ---------- */
    async openCreate() {
      let camps, needs, inventory, dispatches;
      try {
        [camps, needs, inventory, dispatches] = await Promise.all([
          API.list('camps'), API.list('needs'), API.list('inventory'), API.list('dispatches'),
        ]);
      } catch (err) {
        UI.toast('Could not load data: ' + err.message, 'error');
        return;
      }
      const itemById = Object.fromEntries(inventory.map(i => [i.id, i]));

      const campSelect = UI.h('select', {}, camps.map(c =>
        UI.h('option', { value: String(c.id) }, `${c.name} (${c.status})`)));
      const needSelect = UI.h('select', {});
      const qtyInput = UI.h('input', { type: 'number', min: '1', step: '1', placeholder: 'e.g. 50' });
      const hint = UI.h('p', { class: 'hint' }, 'Pick a camp to see its needs.');

      function selectedNeed() { return needs.find(n => n.id === +needSelect.value) || null; }

      function refreshHint() {
        const need = selectedNeed();
        if (!need) { hint.textContent = ''; return; }
        const item = itemById[need.inventory_item_id];
        const rem = remainingUnreserved(need, dispatches);
        const stock = item ? +item.stock : 0;
        const max = Math.max(0, Math.min(stock, rem));
        hint.textContent = `Stock on hand: ${stock} · need remaining (unreserved): ${rem}. Maximum dispatchable now: ${max}.`;
      }

      function loadNeeds() {
        const campId = +campSelect.value;
        needSelect.innerHTML = '';
        const campNeeds = needs.filter(n => n.camp_id === campId);
        if (!campNeeds.length) {
          needSelect.disabled = true;
          qtyInput.disabled = true;
          hint.textContent = 'This camp has no registered needs — add a need first.';
          return;
        }
        needSelect.disabled = false;
        qtyInput.disabled = false;
        for (const n of campNeeds) {
          const item = itemById[n.inventory_item_id];
          const rem = remainingUnreserved(n, dispatches);
          needSelect.append(UI.h('option', { value: String(n.id) },
            `${item ? item.name : 'Need ' + n.id} — remaining ${rem} of ${n.required_quantity} (${n.priority})`));
        }
        refreshHint();
      }

      campSelect.addEventListener('change', loadNeeds);
      needSelect.addEventListener('change', refreshHint);
      qtyInput.addEventListener('input', () => qtyInput.classList.remove('invalid'));
      loadNeeds();

      async function submit(close) {
        const need = selectedNeed();
        if (!need) { UI.toast('Choose a need first', 'error'); return; }
        const qty = Math.floor(+qtyInput.value);
        if (!qtyInput.value || isNaN(qty) || qty <= 0) {
          qtyInput.classList.add('invalid');
          UI.toast('Quantity must be a positive number', 'error');
          return;
        }
        try {
          /* validate against LIVE numbers, the list above may be a moment stale */
          const [freshNeed, freshItem, freshDispatches] = await Promise.all([
            API.get('needs', need.id),
            API.get('inventory', need.inventory_item_id),
            API.list('dispatches'),
          ]);
          const stock = +freshItem.stock;
          const rem = remainingUnreserved(freshNeed, freshDispatches);
          if (qty > stock) {
            qtyInput.classList.add('invalid');
            UI.toast(`Only ${stock} ${freshItem.unit}(s) of ${freshItem.name} in stock — cannot dispatch ${qty}`, 'error');
            return;
          }
          if (qty > rem) {
            qtyInput.classList.add('invalid');
            UI.toast(`Quantity ${qty} exceeds the need's remaining unreserved quantity (${rem})`, 'error');
            return;
          }
          await API.create('dispatches', {
            camp_id: freshNeed.camp_id, need_id: freshNeed.id, quantity: qty, status: 'Pending',
          });
          /* reserve immediately: deduct from warehouse stock */
          await API.update('inventory', freshItem.id, { stock: stock - qty });
          UI.toast(`Dispatch created — ${qty} ${freshItem.unit}(s) of ${freshItem.name} reserved`, 'success');
          close();
          App.render();
        } catch (err) {
          UI.toast('Could not create dispatch: ' + err.message, 'error');
        }
      }

      const form = UI.h('div', { class: 'form' }, [
        UI.h('label', { class: 'field' }, [UI.h('span', {}, 'Camp'), campSelect]),
        UI.h('label', { class: 'field' }, [UI.h('span', {}, 'Camp Need'), needSelect]),
        UI.h('label', { class: 'field' }, [UI.h('span', {}, 'Quantity'), qtyInput]),
      ]);
      const { close } = UI.modal('New Dispatch', UI.h('div', {}, [
        form,
        hint,
        UI.h('div', { class: 'form-actions' }, [
          UI.h('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Cancel'),
          UI.h('button', { class: 'btn btn-primary', onclick: () => submit(close) }, 'Reserve & Create'),
        ]),
      ]));
    },

    /* ---------- transitions ---------- */
    async setStatus(d, status) {
      if (d.status !== 'Pending') {
        UI.toast('Only pending dispatches can be marked In Transit', 'error');
        return;
      }
      try {
        await API.update('dispatches', d.id, { status });
        UI.toast(`Dispatch #${d.id} is now ${status}`, 'success');
        App.render();
      } catch (err) {
        UI.toast('Could not update dispatch: ' + err.message, 'error');
      }
    },

    async markDelivered(d) {
      if (d.status !== 'In Transit') {
        UI.toast('Dispatch must be In Transit before it can be delivered', 'error');
        return;
      }
      if (!UI.confirm(`Mark dispatch #${d.id} as delivered? The need's fulfilled quantity will rise by ${d.quantity}.`)) return;
      try {
        const need = await API.get('needs', d.need_id);
        await API.update('needs', need.id, { fulfilled_quantity: +need.fulfilled_quantity + +d.quantity });
        await API.update('dispatches', d.id, { status: 'Delivered' });
        UI.toast(`Dispatch #${d.id} delivered — need fulfilment updated`, 'success');
        App.render();
      } catch (err) {
        UI.toast('Could not mark delivered: ' + err.message, 'error');
      }
    },

    async cancel(d) {
      if (!ACTIVE.includes(d.status)) {
        UI.toast('Only Pending or In Transit dispatches can be cancelled', 'error');
        return;
      }
      if (!UI.confirm(`Cancel dispatch #${d.id}? The reserved stock (${d.quantity} units) goes back to inventory.`)) return;
      try {
        const need = await API.get('needs', d.need_id);
        const item = await API.get('inventory', need.inventory_item_id);
        /* reservation is released: put the units back */
        await API.update('inventory', item.id, { stock: +item.stock + +d.quantity });
        await API.update('dispatches', d.id, { status: 'Cancelled' });
        UI.toast(`Dispatch #${d.id} cancelled — stock restored`, 'success');
        App.render();
      } catch (err) {
        UI.toast('Could not cancel dispatch: ' + err.message, 'error');
      }
    },
  };

  App.registerModule(mod);
})();
