(function (global) {
  const RulesUI = {
    init(opts) {
      const cfg = {
        mount: opts.mount || '#rules-app',
        token: opts.token || '',
        apiBase: (opts.apiBase || '').replace(/\/+$/, ''),
      };
      cfg.apiRules = cfg.apiBase + '/rules';

      const root = document.querySelector(cfg.mount);
      if (!root) { console.error('RulesUI: mount not found'); return; }

      root.innerHTML = `
        <div class="rules-wrap">
          <div class="rules-card">
            <div class="rules-toolbar">
              <div class="rules-label">Admin API • X-Admin-Token</div>
              <input id="rui-token" class="rules-input" type="password" style="width:280px" placeholder="••••••••">
              <button id="rui-reload" class="rules-btn">Reload</button>

              <div class="filters">
                <input id="f-offer"      class="rules-input" type="text"   placeholder="Filter: Offer ID">
                <input id="f-affiliate"  class="rules-input" type="text"   placeholder="Filter: Affiliate ID">
                <input id="f-sub"        class="rules-input" type="text"   placeholder="Filter: Sub ID of 'null'">
                <input id="f-priority"   class="rules-input" type="number" placeholder="≤ Priority" value="">
                <input id="f-search"     class="rules-input" type="text"   placeholder="Zoek in omschrijving">
                <label class="rules-switch"><input id="f-active" type="checkbox"> Alleen actieve</label>
              </div>
            </div>
            <div id="rui-groups"></div>
          </div>
        </div>
      `;

      root.querySelector('#rui-token').value = cfg.token;
      root.querySelector('#rui-reload').addEventListener('click', () => loadAll(cfg));

      // filter listeners
      root.querySelectorAll('.filters input').forEach(el => {
        el.addEventListener('input', () => applyFilterAndRender(cfg));
        el.addEventListener('change', () => applyFilterAndRender(cfg));
      });

      // eerste load
      loadAll(cfg);
    }
  };

  /* ---------------- helpers ---------------- */
  const state = { allItems: [], cfg: null };

  function hdrs() {
    const t = document.querySelector('#rui-token').value.trim();
    return { 'X-Admin-Token': t, 'Content-Type': 'application/json' };
  }

  const readDesc = (item) =>
    item?.description ?? item?.Omschrijving ?? item?.omschrijving ?? item?.Beschrijving ?? item?.beschrijving ?? '';

  const writeDesc = (payload) => {
    const d = payload?.description ?? payload?.Omschrijving ?? payload?.omschrijving ?? payload?.Beschrijving ?? payload?.beschrijving ?? null;
    const out = { ...payload };
    delete out.description; delete out.omschrijving; delete out.beschrijving; delete out.Beschrijving;
    if (d !== null) out.description = d; // backend accepteert 'description'
    return out;
  };

  const esc = (s) => (s ?? '').toString().replace(/"/g, '&quot;');
  const emptyToNull = (v) => (v === '' ? null : v);
  const normalizeSub = (v) => (v === '' || v === 'null' ? null : v);
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  /* ---------------- loading & filtering ---------------- */
  async function loadAll(cfg) {
    state.cfg = cfg;
    const host = document.querySelector('#rui-groups');
    host.innerHTML = `<div class="rules-empty">Laden…</div>`;
    try {
      const r = await fetch(cfg.apiRules, { headers: hdrs() });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      state.allItems = j.items || [];
      applyFilterAndRender(cfg);
    } catch (e) {
      host.innerHTML = `<div class="rules-empty" style="color:#d92d20">Error ${String(e)}</div>`;
    }
  }

  function applyFilterAndRender(cfg) {
    const fOffer = (document.querySelector('#f-offer')?.value || '').trim();
    const fAff   = (document.querySelector('#f-affiliate')?.value || '').trim();
    const fSub   = (document.querySelector('#f-sub')?.value || '').trim();
    const fPri   = (document.querySelector('#f-priority')?.value || '').trim();
    const fSrch  = (document.querySelector('#f-search')?.value || '').trim().toLowerCase();
    const fAct   = !!document.querySelector('#f-active')?.checked;

    let rows = state.allItems.slice();

    rows = rows.filter(it => {
      if (fOffer && String(it.offer_id ?? '—') !== fOffer) return false;
      if (fAff   && String(it.affiliate_id ?? '') !== fAff) return false;
      if (fSub) {
        const sub = it.sub_id == null ? 'null' : String(it.sub_id);
        if (sub !== fSub) return false;
      }
      if (fPri && Number(it.priority ?? 999999) > Number(fPri)) return false;
      if (fSrch && !readDesc(it).toLowerCase().includes(fSrch)) return false;
      if (fAct && !it.active) return false;
      return true;
    });

    renderGroups(cfg, rows);
  }

  /* ---------------- render ---------------- */
  function groupByOffer(items) {
    const m = {};
    for (const it of items) {
      const k = (it.offer_id === '' || it.offer_id == null) ? '—' : String(it.offer_id);
      if (!m[k]) m[k] = [];
      m[k].push(it);
    }
    return m;
  }

  function offerSort(a, b) {
    if (a === '—' && b !== '—') return 1;
    if (b === '—' && a !== '—') return -1;
    const na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  }

  function renderGroups(cfg, items) {
    const host = document.querySelector('#rui-groups');
    const groups = groupByOffer(items);
    const keys = Object.keys(groups).sort(offerSort);

    if (!keys.length) {
      host.innerHTML = `<div class="rules-empty">Geen regels</div>`;
      return;
    }

    host.innerHTML = '';
    keys.forEach(k => {
      host.appendChild(renderGroup(cfg, k, groups[k]));
    });
  }

  function renderGroup(cfg, offerKey, items) {
    // sorteer binnen offer: priority asc, dan affiliate, sub
    items.sort((a, b) => {
      const pa = Number(a.priority ?? 100), pb = Number(b.priority ?? 100);
      if (pa !== pb) return pa - pb;
      const aa = String(a.affiliate_id ?? ''), ab = String(b.affiliate_id ?? '');
      if (aa !== ab) return aa.localeCompare(ab);
      const sa = String(a.sub_id ?? ''), sb = String(b.sub_id ?? '');
      return sa.localeCompare(sb);
    });

    const el = document.createElement('div');
    el.className = 'group collapsed';
    el.innerHTML = `
      <div class="group-header" data-role="toggle">
        <span class="chev">▸</span>
        <span class="group-title">Offer: ${offerKey === '—' ? '<i>ANY/Global</i>' : escapeHtml(offerKey)}</span>
        <span class="group-sub">${items.length} regel(s)</span>
      </div>

      <div class="group-body">
        <div class="table-wrap">
          <table class="rules">
            <thead>
              <tr>
                <th>Omschrijving</th>
                <th>Affiliate ID</th>
                <th>Sub ID</th>
                <th>ACCEPT %</th>
                <th>Priority</th>
                <th>Active</th>
                <th style="width:160px">Actie</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(rowHtml).join('')}
            </tbody>
          </table>
        </div>

        <!-- één-regel invoer -->
        <div class="newbar">
          <input class="rules-input w-lg" type="text"   data-new="description"    placeholder="Omschrijving">
          <input class="rules-input w-sm" type="text"   data-new="affiliate_id"   placeholder="Affiliate ID (leeg=any)">
          <input class="rules-input w-sm" type="text"   data-new="sub_id"         placeholder="Sub ID (leeg of 'null')">
          <input class="rules-input w-xs" type="number" data-new="percent_accept" placeholder="% Accept" value="50" min="0" max="100">
          <input class="rules-input w-xs" type="number" data-new="priority"       placeholder="Priority" value="100">
          <label class="rules-label" style="display:flex;align-items:center;gap:8px">
            <input class="chk" type="checkbox" data-new="active" checked> Active
          </label>
          <button class="rules-btn ok" data-role="add">Toevoegen</button>
        </div>
      </div>
    `;

    // events
    el.querySelector('[data-role=toggle]').addEventListener('click', () => el.classList.toggle('collapsed'));

    el.querySelector('tbody').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-act]'); if (!btn) return;
      const tr = btn.closest('tr'); const id = tr?.dataset?.id; if (!id) return;

      if (btn.dataset.act === 'delete') {
        if (!confirm('Deze regel verwijderen?')) return;
        fetch(`${cfg.apiRules}/${id}`, { method: 'DELETE', headers: hdrs() })
          .then(r => r.status === 204 ? loadAll(cfg) : r.text().then(t => alert('Delete failed: ' + t)))
          .catch(e => alert('Delete failed: ' + e));
        return;
      }

      if (btn.dataset.act === 'save') {
        const payload = collectRow(tr);
        const body = writeDesc(payload);
        fetch(`${cfg.apiRules}/${id}`, { method: 'PATCH', headers: hdrs(), body: JSON.stringify(body) })
          .then(r => r.ok ? loadAll(cfg) : r.text().then(t => alert('Save failed: ' + t)))
          .catch(e => alert('Save failed: ' + e));
      }
    });

    // toevoegen (offer staat vast op groep)
    el.querySelector('[data-role=add]').addEventListener('click', () => {
      const bar = el.querySelector('.newbar');
      const p = {
        description: value(bar, 'description'),
        affiliate_id: emptyToNull(value(bar, 'affiliate_id')),
        offer_id: (offerKey === '—' ? null : offerKey),
        sub_id: normalizeSub(value(bar, 'sub_id')),
        percent_accept: Number(value(bar, 'percent_accept') || 0),
        priority: Number(value(bar, 'priority') || 100),
        active: !!bar.querySelector('[data-new=active]').checked
      };
      const body = writeDesc(p);
      fetch(`${cfg.apiRules}`, { method: 'POST', headers: hdrs(), body: JSON.stringify(body) })
        .then(async r => {
          if (r.ok) { loadAll(cfg); return; }
          const t = await r.text().catch(() => ''); alert('Create failed: ' + (t || r.status));
        })
        .catch(e => alert('Create failed: ' + e));
    });

    return el;
  }

  function rowHtml(it) {
    const desc = readDesc(it);
    return `
      <tr data-id="${it.id}">
        <td><input type="text" value="${esc(desc)}" data-k="description"></td>
        <td><input type="text" value="${esc(it.affiliate_id)}" data-k="affiliate_id"></td>
        <td><input type="text" value="${esc(it.sub_id)}" data-k="sub_id"></td>
        <td><input type="number" min="0" max="100" value="${Number(it.percent_accept ?? 0)}" data-k="percent_accept"></td>
        <td><input type="number" value="${Number(it.priority ?? 100)}" data-k="priority"></td>
        <td style="text-align:center"><input class="chk" type="checkbox" ${it.active ? 'checked' : ''} data-k="active"></td>
        <td class="row-actions">
          <button class="rules-btn ghost" data-act="save" type="button">Save</button>
          <button class="rules-btn danger" data-act="delete" type="button">Del</button>
        </td>
      </tr>
    `;
  }

  function collectRow(tr) {
    const q = (k) => tr.querySelector(`input[data-k="${k}"]`);
    return {
      description: q('description').value,
      affiliate_id: emptyToNull(q('affiliate_id').value),
      sub_id: normalizeSub(q('sub_id').value),
      percent_accept: Number(q('percent_accept').value || 0),
      priority: Number(q('priority').value || 100),
      active: tr.querySelector('input[data-k="active"]').checked
    };
  }

  function value(root, name) { return root.querySelector(`[data-new="${name}"]`)?.value ?? ''; }

  // expose
  global.RulesUI = RulesUI;
})(window);
