/* MODULE: Live Ops Feed — OWNER: Eshaal (@Eshaal607)
 *
 * A read-only activity timeline that watches the API and turns snapshot diffs
 * into human sentences ("Jamshoro now sheltering 90 families"). Makes the
 * dashboard feel alive during the demo without anybody touching it.
 *
 * How it works:
 *  - On first render we snapshot the five collections (camps, inventory,
 *    needs, dispatches, volunteers). Every 8s while the route is active we
 *    re-fetch and diff fresh-vs-previous; each delta becomes a feed item.
 *  - The interval handle lives at MODULE level: every render stops it first,
 *    so re-renders can never stack timers. A hashchange listener stops it
 *    when you navigate away, and document.hidden pauses it too.
 *  - Phrases follow the app's real business rules (see dispatches.js):
 *    creating a dispatch reserves stock immediately, delivering bumps the
 *    need's fulfilled_quantity, cancelling returns stock to the warehouse.
 *    So a stock drop explained by a new dispatch is NOT reported as a
 *    donation — only unexplained stock movements are.
 *  - Demo mode (API._demoMode, set by api.js when no server answers): show a
 *    banner and synthesize a plausible seed-derived timeline instead — polling
 *    a static db.json can never produce diffs, so no timer runs in demo.
 *  - Single-file constraint: my styles ship inside this file as an injected
 *    <style> tag (styles.css belongs to the team lead).
 *  - The diff engine between the [pure] markers is DOM-free, so it can be
 *    exercised from a plain node harness.
 */
(() => {
  /* my little stylesheet, injected once (styles.css itself is the lead's) */
  if (!document.getElementById('eshaal-opsfeed-css')) {
    const style = document.createElement('style');
    style.id = 'eshaal-opsfeed-css';
    style.textContent = `
      .opsfeed { max-width: 880px; }
      .ops-banner {
        display: flex; gap: 8px; align-items: baseline;
        margin-bottom: var(--sp-4); padding: 10px 14px;
        background: var(--panel-tint); border: 1px dashed var(--line-strong);
        border-radius: var(--r-md); color: var(--muted); font-size: var(--fs-sm);
      }
      .ops-banner strong { color: var(--ink-soft); }
      .ops-statusbar {
        display: flex; align-items: center; gap: 8px;
        margin: 0 0 var(--sp-3); color: var(--muted); font-size: var(--fs-xs);
      }
      .ops-dot {
        width: 8px; height: 8px; border-radius: 50%; flex: none;
        background: var(--brand-500);
        box-shadow: 0 0 0 0 rgba(16, 185, 129, .40);
        animation: opsPulse 2.2s infinite;
      }
      .ops-dot.demo { background: var(--faint); animation: none; box-shadow: none; }
      .ops-dot.warn { background: var(--warn); animation: none; box-shadow: none; }
      @keyframes opsPulse {
        0%   { box-shadow: 0 0 0 0 rgba(16, 185, 129, .40); }
        70%  { box-shadow: 0 0 0 7px rgba(16, 185, 129, 0); }
        100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
      }
      .ops-counter { margin-left: auto; font-variant-numeric: tabular-nums; }
      .ops-feed { display: flex; flex-direction: column; gap: var(--sp-2); }
      .feed-item {
        display: flex; gap: var(--sp-3); align-items: flex-start;
        padding: var(--sp-3) var(--sp-4); background: var(--panel);
        border: 1px solid var(--line); border-radius: var(--r-md);
        box-shadow: var(--shadow-xs);
      }
      .feed-ico {
        flex: none; width: 34px; height: 34px; display: grid; place-items: center;
        font-size: 16px; border-radius: 10px; background: var(--brand-soft);
      }
      .feed-item[data-kind="dispatch"]  .feed-ico { background: var(--brand-100); }
      .feed-item[data-kind="stock"]     .feed-ico { background: var(--ok-soft); }
      .feed-item[data-kind="need"]      .feed-ico { background: var(--warn-soft); }
      .feed-text { margin: 0; font-size: var(--fs-base); color: var(--ink); line-height: 1.45; }
      .feed-time {
        display: block; margin-top: 2px; font-size: var(--fs-2xs);
        color: var(--muted); font-variant-numeric: tabular-nums;
      }
      .feed-new { animation: opsFeedIn .55s cubic-bezier(0.19, 1, 0.22, 1) both; }
      @keyframes opsFeedIn {
        from { opacity: 0; transform: translateY(-12px) scale(.985); }
        to   { opacity: 1; transform: none; }
      }
      .ops-empty {
        padding: var(--sp-5); text-align: center; color: var(--muted);
        font-size: var(--fs-sm); border: 1px dashed var(--line-strong);
        border-radius: var(--r-md); background: var(--panel-tint);
      }
      @media (prefers-reduced-motion: reduce) {
        .feed-new, .ops-dot { animation: none; }
      }
    `;
    document.head.append(style);
  }

  const POLL_INTERVAL = 8000;   /* re-fetch every 8s while the route is active */
  const MAX_ITEMS = 30;         /* feed cap */
  const COLLECTIONS = ['camps', 'inventory', 'needs', 'dispatches', 'volunteers'];

  /* ========================================================================
   * [pure] diff engine — no DOM, no App/API refs. Testable from node:
   * slice this block out of the file and eval it in a harness.
   * ====================================================================== */

  const byId = rows => Object.fromEntries((rows || []).map(r => [String(r.id), r]));

  /* "carton" x50 -> "cartons", x1 -> "carton", "box" x4 -> "boxes";
   * units already plural-shaped ("units" fallback) are left alone */
  function plural(unit, qty) {
    if (+qty === 1) return unit;
    if (unit.endsWith('s')) return unit;
    return unit === 'box' ? 'boxes' : unit + 's';
  }

  /* "just now" / "40s ago" / "2m ago" / "3h ago" / "1d ago" */
  function relTime(ts, now) {
    now = now || Date.now();
    const s = Math.max(0, Math.round((now - ts) / 1000));
    if (s < 10) return 'just now';
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  /* Compare two snapshots ({camps,inventory,needs,dispatches,volunteers}) and
   * translate every change into a feed item. Returns oldest->newest. */
  function diffEvents(prev, next, now) {
    now = now || Date.now();
    const evts = [];
    const add = (icon, text, kind) => evts.push({ icon, text, kind, ts: now });

    const pC = byId(prev.camps), nC = byId(next.camps);
    const pI = byId(prev.inventory), nI = byId(next.inventory);
    const pN = byId(prev.needs), nN = byId(next.needs);
    const pD = byId(prev.dispatches), nD = byId(next.dispatches);
    const pV = byId(prev.volunteers), nV = byId(next.volunteers);

    const campName = (map, id) => { const c = map[String(id)]; return c ? c.name : 'Camp ' + id; };
    const shortCamp = id => { const c = nC[String(id)]; return c ? (c.district || c.name) : 'Camp ' + id; };
    const needOf = d => nN[String(d.need_id)];
    const itemOf = need => (need ? nI[String(need.inventory_item_id)] : null) || {};

    /* stock change caused by dispatch ops this tick (create = -qty reserved,
     * cancel = +qty returned) — used to keep donations and dispatches apart */
    const driven = {};
    const bumpDriven = (itemId, qty) => { if (itemId) driven[itemId] = (driven[itemId] || 0) + qty; };
    /* needs already reported via a Delivered dispatch this tick — don't double-report */
    const touchedNeeds = new Set();

    /* ---- dispatches: created / rolled out / delivered / cancelled ---- */
    for (const d of next.dispatches) {
      const p = pD[String(d.id)];
      const need = needOf(d);
      const item = itemOf(need);
      const unit = item.unit || 'units';
      const qty = +d.quantity || 0;
      const iid = need ? String(need.inventory_item_id) : null;
      const camp = campName(nC, d.camp_id);

      if (!p) {
        add('🚚', `Dispatch created — ${qty} ${plural(unit, qty)} of ${item.name || 'supplies'} reserved for ${camp}`, 'dispatch');
        bumpDriven(iid, -qty);
        continue;
      }
      if (d.status !== p.status) {
        if (p.status === 'Pending' && d.status === 'In Transit') {
          add('🚚', `Dispatch #${d.id} rolled out toward ${shortCamp(d.camp_id)}`, 'dispatch');
        } else if (d.status === 'Delivered') {
          touchedNeeds.add(String(d.need_id));
          const req = +((need || {}).required_quantity) || 0;
          const pct = req ? Math.round((qty / req) * 100) : null;
          add('✅', `${qty} ${plural(unit, qty)} delivered to ${shortCamp(d.camp_id)}` +
            (pct !== null ? ` — fulfilment up ${pct}%` : ''), 'dispatch');
        } else if (d.status === 'Cancelled') {
          add('🚫', `Dispatch #${d.id} cancelled — stock returned to warehouse`, 'dispatch');
          bumpDriven(iid, qty);
        } else {
          add('🔄', `Dispatch #${d.id} at ${camp}: ${p.status} → ${d.status}`, 'dispatch');
        }
      } else if (qty !== +p.quantity) {
        add('⚠️', `Dispatch #${d.id} quantity adjusted ${p.quantity} → ${d.quantity} (${camp})`, 'dispatch');
      }
    }

    /* ---- camps: new / families changed / FULL / closed / reopened ---- */
    for (const c of next.camps) {
      const p = pC[String(c.id)];
      if (!p) {
        add('⛺', `New camp registered — ${c.name} (${c.district || 'new district'})`, 'camp');
        continue;
      }
      if (+c.current_families !== +p.current_families) {
        add('🏕️', `${c.name} now sheltering ${c.current_families} families`, 'camp');
      }
      if (c.status !== p.status) {
        if (c.status === 'Full') add('🔴', `${c.name} is FULL`, 'camp');
        else if (c.status === 'Closed') add('⚪', `${c.name} is now closed`, 'camp');
        else if (p.status === 'Closed') add('🟢', `${c.name} reopened — accepting families again`, 'camp');
        else add('🔄', `${c.name} status: ${p.status} → ${c.status}`, 'camp');
      }
    }
    for (const c of prev.camps) {
      if (!nC[String(c.id)]) add('📉', `${c.name} removed from the camp registry`, 'camp');
    }

    /* ---- needs: new / escalated / fulfilment moved outside a delivery ---- */
    for (const n of next.needs) {
      const p = pN[String(n.id)];
      const item = itemOf(n);
      const camp = campName(nC, n.camp_id);
      if (!p) {
        add('📋', `New need at ${camp} — ${n.required_quantity} ${plural(item.unit || 'units', +n.required_quantity)} of ${item.name || 'supplies'}`, 'need');
        continue;
      }
      if (n.priority !== p.priority) {
        add('⚠️', `${item.name || 'Supplies'} need at ${camp} escalated to ${n.priority} priority`, 'need');
      }
      if (+n.fulfilled_quantity !== +p.fulfilled_quantity) {
        if (!touchedNeeds.has(String(n.id))) {
          const req = +n.required_quantity || 0;
          const pct = req ? Math.round((+n.fulfilled_quantity / req) * 100) : 0;
          add('📈', `${item.name || 'Supplies'} at ${camp} now ${pct}% fulfilled`, 'need');
        }
      }
      if (+n.required_quantity !== +p.required_quantity) {
        add('📋', `${camp} raised its ${item.name || 'supplies'} need to ${n.required_quantity}`, 'need');
      }
    }

    /* ---- inventory: donations & corrections = stock moves with no dispatch behind them ---- */
    for (const it of next.inventory) {
      const p = pI[String(it.id)];
      const iid = String(it.id);
      if (!p) {
        add('🏷️', `New supply line — ${it.name} (${it.stock} ${plural(it.unit, +it.stock)} in stock)`, 'stock');
        continue;
      }
      const unexplained = (+it.stock || 0) - (+p.stock || 0) - (driven[iid] || 0);
      if (unexplained > 0) add('📦', `+${unexplained} ${it.name} donated into stock`, 'stock');
      else if (unexplained < 0) add('⚠️', `${it.name} stock corrected down ${-unexplained} ${plural(it.unit, -unexplained)}`, 'stock');
    }
    for (const it of prev.inventory) {
      if (!nI[String(it.id)]) add('🗑️', `${it.name} removed from inventory`, 'stock');
    }

    /* ---- volunteers: joined / deployed / reassigned / stood down ---- */
    for (const v of next.volunteers) {
      const p = pV[String(v.id)];
      if (!p) {
        add('🙋', `${v.name} joined the roster — ${v.skill || 'general'} volunteer`, 'volunteer');
        continue;
      }
      if (String(v.camp_id) === String(p.camp_id)) continue;
      if (v.camp_id != null) {
        const moved = p.camp_id != null;
        add('🙋', `${v.name} ${moved ? 'reassigned to' : 'deployed to'} ${campName(nC, v.camp_id)}`, 'volunteer');
      } else {
        add('🙋', `${v.name} stood down from ${campName(pC, p.camp_id)} — available again`, 'volunteer');
      }
    }
    for (const v of prev.volunteers) {
      if (!nV[String(v.id)]) add('👋', `${v.name} left the volunteer roster`, 'volunteer');
    }

    return evts;
  }

  /* Demo mode: db.json is static, so nothing can ever diff — synthesize a
   * plausible timeline straight from the seed's own dispatches/needs/camps. */
  function synthDemoEvents(snap, now) {
    now = now || Date.now();
    const camps = snap.camps || [], items = snap.inventory || [], needs = snap.needs || [];
    const ds = snap.dispatches || [], vols = snap.volunteers || [];
    const camp = id => camps.find(c => c.id === id) || {};
    const need = id => needs.find(n => n.id === id) || {};
    const item = id => items.find(i => i.id === id) || {};
    const byNewest = (a, b) => b.id - a.id;

    const seq = [];
    const deployed = vols.find(v => v.camp_id != null);
    if (deployed) seq.push(['🙋', `${deployed.name} deployed to ${camp(deployed.camp_id).name || 'the field'}`, 'volunteer']);
    const hygiene = items.find(i => /hygiene/i.test(i.name));
    if (hygiene) seq.push(['📦', `+40 ${hygiene.name} donated into stock`, 'stock']);
    const full = camps.find(c => c.status === 'Full');
    if (full) seq.push(['🔴', `${full.name} is FULL`, 'camp']);
    const busy = camps.filter(c => c.status !== 'Closed')
      .sort((a, b) => b.current_families - a.current_families)[0];
    if (busy) seq.push(['🏕️', `${busy.name} now sheltering ${busy.current_families} families`, 'camp']);
    const cancelled = ds.filter(d => d.status === 'Cancelled').sort(byNewest)[0];
    if (cancelled) seq.push(['🚫', `Dispatch #${cancelled.id} cancelled — stock returned to warehouse`, 'dispatch']);
    const delivered = ds.filter(d => d.status === 'Delivered').sort(byNewest)[0];
    if (delivered) {
      const n = need(delivered.need_id), it = item(n.inventory_item_id);
      const req = +n.required_quantity || 0;
      seq.push(['✅', `${delivered.quantity} ${plural(it.unit || 'units', delivered.quantity)} delivered to ` +
        (camp(delivered.camp_id).district || camp(delivered.camp_id).name || 'the field') +
        (req ? ` — fulfilment up ${Math.round((delivered.quantity / req) * 100)}%` : ''), 'dispatch']);
    }
    const transit = ds.filter(d => d.status === 'In Transit').sort(byNewest)[0];
    if (transit) seq.push(['🚚', `Dispatch #${transit.id} rolled out toward ` +
      (camp(transit.camp_id).district || 'the field'), 'dispatch']);
    const pending = ds.filter(d => d.status === 'Pending').sort(byNewest)[0];
    if (pending) {
      const it = item(need(pending.need_id).inventory_item_id);
      seq.push(['🚚', `Dispatch created — ${pending.quantity} ${plural(it.unit || 'units', pending.quantity)} of ` +
        `${it.name || 'supplies'} reserved for ${camp(pending.camp_id).name || 'camp'}`, 'dispatch']);
    }
    /* oldest -> newest, ~70s apart, so the newest lands on "just now" */
    return seq.map(([icon, text, kind], i) =>
      ({ icon, text, kind, ts: now - (seq.length - i) * 70 * 1000 }));
  }

  /* [/pure] */

  /* ======================================================================
   * Module state — everything at module level so re-renders never stack
   * timers and the timeline survives route round-trips within a session.
   * ==================================================================== */
  let _timer = null;          /* the one interval handle */
  let _polling = false;       /* a fetch is in flight — skip ticks until done */
  let _prev = null;           /* previous snapshot (the diff baseline) */
  let _events = [];           /* feed items, newest first, capped at MAX_ITEMS */
  let _sessionSeen = 0;       /* events seen this session (uncapped) */
  let _eventSeq = 0;          /* monotonically increasing event id */
  let _paintedSeq = 0;        /* ids <= this are already on screen (no re-animate) */
  let _lastCheck = 0;         /* Date.now() of the last successful poll */
  let _reconnecting = false;  /* last poll failed — holding the last snapshot */
  let _demo = false;          /* API._demoMode at poll time */
  let _root = null, _bannerEl = null, _statusText = null, _counterEl = null, _listEl = null;

  function stopPolling() {
    if (_timer) { clearInterval(_timer); _timer = null; }
  }

  function startPolling() {
    stopPolling(); /* never two handles */
    if (_demo || document.hidden) return; /* static demo data can't diff; hidden tabs don't poll */
    _timer = setInterval(() => { if (!document.hidden && !_polling) poll(); }, POLL_INTERVAL);
  }

  async function fetchSnapshot() {
    const [camps, inventory, needs, dispatches, volunteers] =
      await Promise.all(COLLECTIONS.map(c => API.list(c)));
    return { camps, inventory, needs, dispatches, volunteers };
  }

  async function poll() {
    if (_polling) return;
    _polling = true;
    try {
      const snap = await fetchSnapshot();
      _demo = !!API._demoMode;
      _reconnecting = false;
      if (_prev) {
        const evts = diffEvents(_prev, snap);
        if (evts.length) pushEvents(evts);
      } else if (_demo) {
        pushEvents(synthDemoEvents(snap));
      }
      _prev = snap;             /* only a successful fetch replaces the baseline */
      _lastCheck = Date.now();
      paintStatus();
      paintTimes();
    } catch (e) {
      /* silent: keep the last snapshot, flag the reconnecting state */
      _reconnecting = true;
      paintStatus();
    } finally {
      _polling = false;
    }
  }

  function pushEvents(evts) {
    if (!evts.length) return;
    const now = Date.now();
    const stamped = evts.map(e => ({ id: ++_eventSeq, ts: e.ts || now, icon: e.icon, text: e.text, kind: e.kind }));
    _events = [...stamped.reverse(), ..._events].slice(0, MAX_ITEMS); /* newest first, capped */
    _sessionSeen += stamped.length;
    paintList(true);
    paintStatus();
  }

  function paintList(animate) {
    if (!_listEl) return;
    const reduce = typeof App !== 'undefined' && App._reduceMotion && App._reduceMotion();
    _listEl.innerHTML = '';
    if (!_events.length) {
      _listEl.append(UI.h('div', { class: 'ops-empty' },
        _demo ? 'Demo data — timeline synthesized from the seed.'
              : 'Watching operations… changes will appear here live.'));
      return;
    }
    _events.forEach((e, i) => {
      const isNew = animate && e.id > _paintedSeq && !reduce;
      const row = UI.h('article', { class: 'feed-item' + (isNew ? ' feed-new' : ''), 'data-kind': e.kind }, [
        UI.h('span', { class: 'feed-ico', 'aria-hidden': 'true' }, e.icon),
        UI.h('div', { class: 'feed-body' }, [
          UI.h('p', { class: 'feed-text' }, e.text),
          UI.h('span', { class: 'feed-time', 'data-ts': String(e.ts) }, relTime(e.ts)),
        ]),
      ]);
      if (isNew) row.style.animationDelay = Math.min(i, 8) * 45 + 'ms'; /* soft stagger */
      _listEl.append(row);
    });
    _paintedSeq = _eventSeq;
  }

  function paintStatus() {
    if (!_root || !_statusText || !_counterEl) return;
    let dot = 'live', label;
    if (_demo) { dot = 'demo'; label = 'Demo mode — polling off, timeline synthesized'; }
    else if (_reconnecting) { dot = 'warn'; label = 'Reconnecting… holding the last snapshot'; }
    else label = 'Live — polling every 8s';
    const dotEl = _root.querySelector('.ops-dot');
    if (dotEl) dotEl.className = 'ops-dot ' + dot;
    if (_bannerEl) _bannerEl.style.display = _demo ? '' : 'none';
    _statusText.textContent = label;
    const n = _sessionSeen;
    _counterEl.textContent = _lastCheck
      ? `${n} event${n === 1 ? '' : 's'} this session · last checked ${relTime(_lastCheck)}`
      : `${n} events this session · checking…`;
  }

  /* age the relative-time labels on every tick */
  function paintTimes() {
    if (!_root) return;
    _root.querySelectorAll('.feed-time[data-ts]').forEach(el => {
      el.textContent = relTime(+el.dataset.ts);
    });
  }

  App.registerModule({
    id: 'opsfeed', title: 'Ops Feed', icon: '📡', order: 10,
    subtitle: 'Live activity timeline — what changed since you last looked',

    async render() {
      stopPolling(); /* first thing, every render — no stacked timers, ever */

      const root = UI.h('div', { class: 'opsfeed' });
      const banner = UI.h('div', { class: 'ops-banner', role: 'note' }, [
        UI.h('strong', {}, 'Demo data'),
        ' — start the local API to see live events',
      ]);
      const statusbar = UI.h('div', { class: 'ops-statusbar' }, [
        UI.h('span', { class: 'ops-dot live', 'aria-hidden': 'true' }),
        UI.h('span', { class: 'ops-status-text' }, 'Connecting…'),
        UI.h('span', { class: 'ops-counter' }, ''),
      ]);
      const list = UI.h('div', { class: 'ops-feed' });
      root.append(banner, UI.h('div', { class: 'panel ops-panel' }, [
        UI.h('h3', {}, 'Live operations'),
        statusbar,
        list,
      ]));

      _root = root; _bannerEl = banner; _listEl = list;
      _statusText = statusbar.querySelector('.ops-status-text');
      _counterEl = statusbar.querySelector('.ops-counter');
      paintList(false); /* replay anything already seen this session */
      paintStatus();

      const seq = App._renderSeq; /* detect "user navigated away mid-fetch" */
      await poll();
      if (App._renderSeq !== seq) return root; /* stale render — no timer */
      if (!_demo) startPolling();
      return root;
    },
  });

  /* Route watchers — registered once at module level. */
  window.addEventListener('hashchange', () => {
    if ((location.hash.replace('#/', '') || 'home') !== 'opsfeed') stopPolling();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopPolling(); return; }
    if (_root && _root.isConnected && (location.hash.replace('#/', '') || 'home') === 'opsfeed') {
      startPolling();
    }
  });
})();
