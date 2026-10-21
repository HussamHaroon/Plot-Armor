/* MODULE: Donations (Milestone 4, part A) — OWNER: Syeda Anusha Ali (@SyedaAnushaAli)
 *
 * Rules from the issue:
 *  - Record Cash and In-Kind donations.
 *      * Cash: amount (number > 0) + category (e.g. General/Zakat/Sponsor).
 *      * In-Kind: pick an inventory item + quantity (> 0); recording it must
 *        INCREASE that item's stock (API.update('inventory', itemId, {stock: ...})).
 *  - Show total cash received and totals per donation category (aggregate
 *    client-side from the donations collection; a small summary card row or
 *    table on top of the list).
 *  - Coordinator-only mutations (App.canEdit()); volunteers read-only.
 */
(() => {
  if (!document.getElementById('anusha-css')) {
    const link = document.createElement('link');
    link.id = 'anusha-css';
    link.rel = 'stylesheet';
    link.href = 'js/modules/anusha.css';
    document.head.append(link);
  }

  const CASH_CATEGORIES = ['General', 'Zakat', 'Sponsor'];

  const mod = {
    id: 'donations', title: 'Donations', icon: '💰', order: 5,
    subtitle: 'Cash and in-kind contributions',

    async render() {
      const [donations, inventory] = await Promise.all([
        API.list('donations'), API.list('inventory'),
      ]);
      const itemById = Object.fromEntries(inventory.map(i => [i.id, i]));

      const root = UI.h('div');

      /* summary cards — cash total + per-category, aggregated client-side */
      const cashDonations = donations.filter(d => d.type === 'Cash');
      const totalCash = cashDonations.reduce((s, d) => s + (+d.amount_or_quantity || 0), 0);
      const byCategory = {};
      for (const c of CASH_CATEGORIES) byCategory[c] = 0; /* show all three even at 0 */
      for (const d of cashDonations) {
        byCategory[d.category] = (byCategory[d.category] || 0) + (+d.amount_or_quantity || 0);
      }
      const inKind = donations.filter(d => d.type === 'In-Kind');
      const inKindUnits = inKind.reduce((s, d) => s + (+d.amount_or_quantity || 0), 0);

      root.append(UI.h('div', { class: 'cards' }, [
        UI.h('div', { class: 'card' }, [
          UI.h('div', { class: 'card-label' }, 'Total Cash Received'),
          UI.h('div', { class: 'card-value' }, 'PKR ' + totalCash.toLocaleString()),
          UI.h('div', { class: 'card-sub' }, cashDonations.length + ' cash donations'),
        ]),
        ...CASH_CATEGORIES.map(c => UI.h('div', { class: 'card' }, [
          UI.h('div', { class: 'card-label' }, c),
          UI.h('div', { class: 'card-value' }, 'PKR ' + (byCategory[c] || 0).toLocaleString()),
          UI.h('div', { class: 'card-sub' }, cashDonations.filter(d => d.category === c).length + ' donations'),
        ])),
        UI.h('div', { class: 'card' }, [
          UI.h('div', { class: 'card-label' }, 'In-Kind Received'),
          UI.h('div', { class: 'card-value' }, inKindUnits.toLocaleString() + ' units'),
          UI.h('div', { class: 'card-sub' }, inKind.length + ' donations added to stock'),
        ]),
      ]));

      /* toolbar */
      root.append(UI.h('div', { class: 'toolbar' }, [
        App.canEdit()
          ? UI.h('button', { class: 'btn btn-primary', onclick: () => mod.openCreate() }, '+ Record Donation')
          : null,
      ]));

      const rows = donations.slice().sort((a, b) => b.id - a.id);
      root.append(UI.h('div', { class: 'panel' }, [
        UI.h('h3', {}, `Donation Log (${rows.length})`),
        UI.table([
          { key: 'id', label: '#' },
          { label: 'Type', render: d => UI.badge(d.type, d.type === 'Cash' ? 'info' : 'ok') },
          { label: 'Details', render: d => {
              if (d.type === 'Cash') return 'PKR ' + (+d.amount_or_quantity).toLocaleString();
              const item = itemById[d.item_id];
              const qty = +d.amount_or_quantity;
              return item ? `${qty.toLocaleString()} ${item.unit}(s) of ${item.name}` : `${qty.toLocaleString()} units (item removed)`;
            } },
          { label: 'Category', render: d => UI.badge(d.category || '—', 'muted') },
        ], rows, 'No donations recorded yet.'),
      ]));

      return root;
    },

    /* ---------- record a donation: cash goes on the books, in-kind also bumps stock ---------- */
    async openCreate() {
      let inventory;
      try { inventory = await API.list('inventory'); }
      catch (err) { UI.toast('Could not load inventory: ' + err.message, 'error'); return; }

      const typeSelect = UI.h('select', {}, ['Cash', 'In-Kind'].map(t => UI.h('option', { value: t }, t)));

      const amountInput = UI.h('input', { type: 'number', min: '1', step: '1', placeholder: 'e.g. 25000' });
      const categorySelect = UI.h('select', {}, CASH_CATEGORIES.map(c => UI.h('option', { value: c }, c)));

      const itemSelect = UI.h('select', {}, inventory.map(i =>
        UI.h('option', { value: String(i.id) }, `${i.name} (${i.stock} ${i.unit}(s) in stock)`)));
      const qtyInput = UI.h('input', { type: 'number', min: '1', step: '1', placeholder: 'e.g. 100' });

      const cashFields = UI.h('div', { class: 'form' }, [
        UI.h('label', { class: 'field' }, [UI.h('span', {}, 'Amount (PKR)'), amountInput]),
        UI.h('label', { class: 'field' }, [UI.h('span', {}, 'Category'), categorySelect]),
      ]);
      const kindFields = UI.h('div', { class: 'form' }, [
        UI.h('label', { class: 'field' }, [UI.h('span', {}, 'Inventory Item'), itemSelect]),
        UI.h('label', { class: 'field' }, [UI.h('span', {}, 'Quantity Received'), qtyInput]),
      ]);
      const hint = UI.h('p', { class: 'hint' }, 'In-kind donations are added straight into warehouse stock.');

      function syncFields() {
        const cash = typeSelect.value === 'Cash';
        cashFields.style.display = cash ? '' : 'none';
        kindFields.style.display = cash ? 'none' : '';
      }
      typeSelect.addEventListener('change', syncFields);
      amountInput.addEventListener('input', () => amountInput.classList.remove('invalid'));
      qtyInput.addEventListener('input', () => qtyInput.classList.remove('invalid'));
      syncFields();

      async function submit(close) {
        try {
          if (typeSelect.value === 'Cash') {
            const amount = Math.floor(+amountInput.value);
            if (!amountInput.value || isNaN(amount) || amount <= 0) {
              amountInput.classList.add('invalid');
              UI.toast('Amount must be a positive number', 'error');
              return;
            }
            await API.create('donations', {
              type: 'Cash', amount_or_quantity: amount, item_id: null, category: categorySelect.value,
            });
            UI.toast(`Cash donation of PKR ${amount.toLocaleString()} recorded (${categorySelect.value})`, 'success');
          } else {
            const itemId = +itemSelect.value;
            const qty = Math.floor(+qtyInput.value);
            if (!itemId) { UI.toast('Pick an inventory item', 'error'); return; }
            if (!qtyInput.value || isNaN(qty) || qty <= 0) {
              qtyInput.classList.add('invalid');
              UI.toast('Quantity must be a positive number', 'error');
              return;
            }
            const item = await API.get('inventory', itemId); /* fresh stock */
            await API.create('donations', {
              type: 'In-Kind', amount_or_quantity: qty, item_id: itemId, category: item.category,
            });
            /* the whole point: receiving goods increases warehouse stock */
            await API.update('inventory', itemId, { stock: +item.stock + qty });
            UI.toast(`${qty} ${item.unit}(s) of ${item.name} added to stock`, 'success');
          }
          close();
          App.render();
        } catch (err) {
          UI.toast('Could not record donation: ' + err.message, 'error');
        }
      }

      const { close } = UI.modal('Record Donation', UI.h('div', {}, [
        UI.h('div', { class: 'form' }, [UI.h('label', { class: 'field' }, [UI.h('span', {}, 'Type'), typeSelect])]),
        cashFields,
        kindFields,
        hint,
        UI.h('div', { class: 'form-actions' }, [
          UI.h('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Cancel'),
          UI.h('button', { class: 'btn btn-primary', onclick: () => submit(close) }, 'Save Donation'),
        ]),
      ]));
    },
  };

  App.registerModule(mod);
})();
