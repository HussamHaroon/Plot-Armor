/* MODULE: Camp Management (Milestone 1) — OWNER: Eshaal (@Eshaal607)
 *
 * Rules from the issue:
 *  - Roles: Relief Coordinator (Admin) and Field Volunteer. Only Coordinators may
 *    create/edit/delete — gate every mutating control behind App.canEdit().
 *  - Camp fields: name, district, capacity, current_families, status.
 *    Validate: name/district non-empty, capacity > 0, current_families >= 0,
 *    current_families may exceed capacity but then the camp must show Full.
 *  - Search camps by name OR district (single search box matches either),
 *    plus a status filter dropdown (All/Active/Full/Closed).
 *  - Automatically mark a camp "Full" when current_families reaches capacity,
 *    and revert to "Active" when it drops below (never auto-change "Closed").
 *
 * Available helpers: API.list/create/update/remove('camps', ...), UI.table/form/
 * badge/statusBadge/confirm/toast, UI.pct(). Status values: Active | Full | Closed.
 */
(function () {
  /* Load my little extra stylesheet once (styles.css itself is the lead's). */
  if (!document.getElementById('eshaal-module-css')) {
    const link = document.createElement('link');
    link.id = 'eshaal-module-css';
    link.rel = 'stylesheet';
    link.href = 'js/modules/eshaal.css';
    document.head.append(link);
  }
})();

App.registerModule({
  id: 'camps', title: 'Camps', icon: '⛺', order: 1,
  subtitle: 'Camp registry — search, status and capacity management',
  async render() {
    const camps = await API.list('camps');
    const canEdit = App.canEdit();
    const root = UI.h('div');

    /* Filter state — the table body refreshes live without refetching. */
    let query = '';
    let statusFilter = 'All';
    const tableBox = UI.h('div');
    const countNote = UI.h('span', { class: 'toolbar-note' });

    function matches(c) {
      if (statusFilter !== 'All' && c.status !== statusFilter) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.district.toLowerCase().includes(q);
    }

    function refresh() {
      const visible = camps.filter(matches);
      countNote.textContent = `${visible.length} of ${camps.length} camps shown`;
      tableBox.innerHTML = '';
      tableBox.append(buildTable(visible));
    }

    function buildTable(rows) {
      return UI.table(buildColumns(), rows, query || statusFilter !== 'All'
        ? 'No camps match your search or filter.'
        : (canEdit ? 'No camps yet — add the first one.' : 'No camps registered yet.'));
    }

    function buildColumns() {
      const columns = [
        { key: 'name', label: 'Camp Name' },
        { key: 'district', label: 'District' },
        { key: 'current_families', label: 'Families (current / capacity)', render: c => `${c.current_families} / ${c.capacity}` },
        { key: 'status', label: 'Status', render: c => UI.statusBadge(c.status) },
      ];
      if (canEdit) {
        columns.push({
          label: 'Actions',
          render: c => UI.h('div', { class: 'row-actions' }, [
            UI.h('button', { class: 'btn btn-sm btn-ghost', onclick: () => openCampForm(c) }, 'Edit'),
            UI.h('button', { class: 'btn btn-sm btn-danger', onclick: () => removeCamp(c) }, 'Delete'),
          ]),
        });
      }
      return columns;
    }

    function openCampForm(camp) {
      const fields = [
        { name: 'name', label: 'Camp Name', placeholder: 'e.g. Jamshoro Relief Camp' },
        { name: 'district', label: 'District', placeholder: 'e.g. Jamshoro' },
        { name: 'capacity', label: 'Capacity (families)', type: 'number', min: 1, placeholder: '0' },
        { name: 'current_families', label: 'Current Families', type: 'number', min: 0, placeholder: '0' },
        { name: 'status', label: 'Status', options: ['Active', 'Full', 'Closed'] },
      ];
      const form = UI.form(fields);

      /* UI.form doesn't take initial values, so prefill its inputs by field order. */
      if (camp) {
        const els = form.el.querySelectorAll('input, select');
        fields.forEach((f, i) => { els[i].value = camp[f.name]; });
      }

      async function save() {
        const v = form.getValues();
        if (!v) return;
        /* Full/Active is derived from capacity, Closed is a manual choice. */
        v.status = v.status === 'Closed' ? 'Closed' : (v.current_families >= v.capacity ? 'Full' : 'Active');
        try {
          if (camp) await API.update('camps', camp.id, v);
          else await API.create('camps', v);
          m.close();
          UI.toast(`Camp "${v.name}" ${camp ? 'updated' : 'added'}`, 'success');
          App.render();
        } catch (err) {
          UI.toast('Could not save camp: ' + err.message, 'error');
        }
      }

      const body = UI.h('div', {}, [
        form.el,
        UI.h('div', { class: 'form-actions' }, [
          UI.h('button', { class: 'btn btn-primary', onclick: save }, camp ? 'Save Changes' : 'Add Camp'),
          UI.h('button', { class: 'btn btn-ghost', onclick: () => m.close() }, 'Cancel'),
        ]),
      ]);
      const m = UI.modal(camp ? 'Edit Camp' : 'New Camp', body);
    }

    async function removeCamp(camp) {
      if (!UI.confirm(`Delete camp "${camp.name}"? This cannot be undone.`)) return;
      try {
        await API.remove('camps', camp.id);
        UI.toast(`Camp "${camp.name}" deleted`, 'success');
        App.render();
      } catch (err) {
        UI.toast('Could not delete camp: ' + err.message, 'error');
      }
    }

    const toolbar = UI.h('div', { class: 'toolbar' }, [
      UI.h('input', {
        type: 'search', placeholder: 'Search by name or district…',
        oninput: e => { query = e.target.value; refresh(); },
      }),
      UI.h('select', {
        onchange: e => { statusFilter = e.target.value; refresh(); },
      }, ['All', 'Active', 'Full', 'Closed'].map(s =>
        UI.h('option', { value: s }, s === 'All' ? 'All statuses' : s))),
      canEdit ? UI.h('button', { class: 'btn btn-primary', onclick: () => openCampForm(null) }, '+ Add Camp') : null,
      countNote,
    ]);
    root.append(toolbar, tableBox);
    refresh();

    return root;
  },
});
