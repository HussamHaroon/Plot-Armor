/* MODULE: Camp Needs (Milestone 2, part B) — OWNER: Eshaal (@Eshaal607)
 *
 * Rules from the issue:
 *  - Add, edit and remove a camp's needs. Each need links a camp to an inventory
 *    item: camp_id + inventory_item_id + required_quantity + priority (High/
 *    Medium/Low) + fulfilled_quantity (starts at 0 for new needs).
 *  - Show need fulfilment progress: fulfilled ÷ required as a progress bar
 *    (CSS classes .progress > div, set inner width to the %) plus the % text.
 *  - Validation: required_quantity > 0, camp and item must be selected.
 *  - Filter by camp or priority, sort by priority / least fulfilled / camp.
 *
 * NOTE: fulfilled_quantity is advanced by Delivered dispatches (Anusha's module).
 * Read it, render it, but do not mutate it from this module.
 */
App.registerModule({
  id: 'needs', title: 'Camp Needs', icon: '🧾', order: 3,
  subtitle: 'Unmet demand per camp with fulfilment progress',
  async render() {
    const [camps, items, needs] = await Promise.all([
      API.list('camps'), API.list('inventory'), API.list('needs'),
    ]);
    const campById = Object.fromEntries(camps.map(c => [c.id, c]));
    const itemById = Object.fromEntries(items.map(i => [i.id, i]));
    const canEdit = App.canEdit();
    const root = UI.h('div');

    /* Filter + sort state — the table body refreshes live from the loaded list. */
    let campFilter = 'All';
    let priorityFilter = 'All';
    let sortMode = 'priority';
    const tableBox = UI.h('div');
    const countNote = UI.h('span', { class: 'toolbar-note' });

    const PRIORITY_ORDER = { High: 0, Medium: 1, Low: 2 };

    function isUnmet(n) { return +n.fulfilled_quantity < +n.required_quantity; }

    function matches(n) {
      if (campFilter !== 'All' && String(n.camp_id) !== campFilter) return false;
      if (priorityFilter !== 'All' && n.priority !== priorityFilter) return false;
      return true;
    }

    function sorted(rows) {
      const copy = [...rows];
      if (sortMode === 'priority') {
        copy.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
      } else if (sortMode === 'least-fulfilled') {
        copy.sort((a, b) => UI.pct(+a.fulfilled_quantity, +a.required_quantity)
          - UI.pct(+b.fulfilled_quantity, +b.required_quantity));
      } else if (sortMode === 'camp') {
        copy.sort((a, b) => ((campById[a.camp_id] || {}).name || '')
          .localeCompare((campById[b.camp_id] || {}).name || ''));
      }
      return copy;
    }

    function refresh() {
      const visible = sorted(needs.filter(matches));
      const unmet = visible.filter(isUnmet).length;
      countNote.textContent = `${visible.length} of ${needs.length} needs · ${unmet} not fully fulfilled`;
      tableBox.innerHTML = '';
      tableBox.append(UI.table(buildColumns(), visible, campFilter !== 'All' || priorityFilter !== 'All'
        ? 'No needs match your filters.'
        : (canEdit ? 'No needs recorded yet — add the first one.' : 'No needs recorded yet.')));
    }

    /* UI.form selects show label text as the option value, so I match names
     * back to ids after submit (camp/item names are unique in practice). */
    function openNeedForm(need) {
      if (!camps.length || !items.length) {
        UI.toast('You need at least one camp and one inventory item first.', 'error');
        return;
      }
      const fields = [
        { name: 'camp', label: 'Camp', options: ['', ...camps.map(c => c.name)] },
        { name: 'item', label: 'Inventory Item', options: ['', ...items.map(i => i.name)] },
        { name: 'required_quantity', label: 'Required Quantity', type: 'number', min: 1, placeholder: '0' },
        { name: 'priority', label: 'Priority', options: ['High', 'Medium', 'Low'] },
      ];
      const form = UI.form(fields);

      /* Give the blank first options a hint label (value stays '' so the
       * built-in required validation still catches "nothing picked"). */
      const selects = form.el.querySelectorAll('select');
      selects[0].options[0].textContent = '— select a camp —';
      selects[1].options[0].textContent = '— select an item —';

      /* Prefill on edit (fulfilled_quantity is intentionally NOT editable —
       * dispatches advance it, not this form). */
      if (need) {
        const els = form.el.querySelectorAll('input, select');
        els[0].value = (campById[need.camp_id] || {}).name || '';
        els[1].value = (itemById[need.inventory_item_id] || {}).name || '';
        els[2].value = need.required_quantity;
        els[3].value = need.priority;
      }

      async function save() {
        const v = form.getValues();
        if (!v) return;
        const camp = camps.find(c => c.name === v.camp);
        const item = items.find(i => i.name === v.item);
        if (!camp || !item) {
          UI.toast('Please pick a valid camp and item.', 'error');
          return;
        }
        const payload = {
          camp_id: camp.id,
          inventory_item_id: item.id,
          required_quantity: v.required_quantity,
          priority: v.priority,
        };
        try {
          if (need) await API.update('needs', need.id, payload);
          else await API.create('needs', { ...payload, fulfilled_quantity: 0 });
          m.close();
          UI.toast(`Need for ${camp.name} ${need ? 'updated' : 'added'}`, 'success');
          App.render();
        } catch (err) {
          UI.toast('Could not save need: ' + err.message, 'error');
        }
      }

      const body = UI.h('div', {}, [
        form.el,
        UI.h('div', { class: 'form-actions' }, [
          UI.h('button', { class: 'btn btn-primary', onclick: save }, need ? 'Save Changes' : 'Add Need'),
          UI.h('button', { class: 'btn btn-ghost', onclick: () => m.close() }, 'Cancel'),
        ]),
      ]);
      const m = UI.modal(need ? 'Edit Camp Need' : 'New Camp Need', body);
    }

    async function removeNeed(need) {
      const camp = campById[need.camp_id] || {};
      const item = itemById[need.inventory_item_id] || {};
      if (!UI.confirm(`Remove the need for ${item.name || 'an item'} at ${camp.name || 'this camp'}?`)) return;
      try {
        await API.remove('needs', need.id);
        UI.toast('Need removed', 'success');
        App.render();
      } catch (err) {
        UI.toast('Could not remove need: ' + err.message, 'error');
      }
    }

    function progressBar(n) {
      const p = UI.pct(+n.fulfilled_quantity, +n.required_quantity);
      const color = p >= 100 ? 'var(--ok)' : p >= 50 ? 'var(--info)' : p >= 25 ? 'var(--warn)' : 'var(--bad)';
      return UI.h('div', { class: 'need-progress' }, [
        UI.h('div', { class: 'progress' }, UI.h('div', { style: `width:${Math.min(p, 100)}%;background:${color}` })),
        UI.h('span', { class: 'muted' }, `${p}% (${n.fulfilled_quantity}/${n.required_quantity})`),
      ]);
    }

    function buildColumns() {
      const columns = [
        { label: 'Camp', render: n => (campById[n.camp_id] || {}).name || `Camp #${n.camp_id}` },
        { label: 'Item', render: n => {
          const it = itemById[n.inventory_item_id] || {};
          return UI.h('span', {}, [
            it.name || `Item #${n.inventory_item_id}`,
            it.unit ? UI.h('span', { class: 'muted' }, ` · ${it.unit}`) : null,
          ]);
        } },
        { label: 'Required', render: n => (+n.required_quantity).toLocaleString() },
        { label: 'Fulfilled', render: n => (+n.fulfilled_quantity).toLocaleString() },
        { label: 'Priority', render: n => UI.priorityBadge(n.priority) },
        { label: 'Progress', render: progressBar },
      ];
      if (canEdit) {
        columns.push({
          label: 'Actions',
          render: n => UI.h('div', { class: 'row-actions' }, [
            UI.h('button', { class: 'btn btn-sm btn-ghost', onclick: () => openNeedForm(n) }, 'Edit'),
            UI.h('button', { class: 'btn btn-sm btn-danger', onclick: () => removeNeed(n) }, 'Delete'),
          ]),
        });
      }
      return columns;
    }

    root.append(UI.h('div', { class: 'toolbar' }, [
      UI.h('select', {
        onchange: e => { campFilter = e.target.value; refresh(); },
      }, [UI.h('option', { value: 'All' }, 'All camps'),
        ...camps.map(c => UI.h('option', { value: String(c.id) }, c.name))]),
      UI.h('select', {
        onchange: e => { priorityFilter = e.target.value; refresh(); },
      }, [UI.h('option', { value: 'All' }, 'All priorities'),
        ...['High', 'Medium', 'Low'].map(p => UI.h('option', { value: p }, p))]),
      UI.h('select', {
        onchange: e => { sortMode = e.target.value; refresh(); },
      }, [
        UI.h('option', { value: 'priority' }, 'Sort: priority'),
        UI.h('option', { value: 'least-fulfilled' }, 'Sort: least fulfilled'),
        UI.h('option', { value: 'camp' }, 'Sort: camp name'),
      ]),
      canEdit ? UI.h('button', { class: 'btn btn-primary', onclick: () => openNeedForm(null) }, '+ Add Need') : null,
      countNote,
    ]));
    root.append(tableBox);
    refresh();

    return root;
  },
});
