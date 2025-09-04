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
          <div class="rules-card" id="rules-card">
            <div class="rules-toolbar">
              <div class="rules-label">Admin API • X-Admin-Token</div>
              <input id="rui-token" class="rules-input" type="password" style="width:280px" placeholder="voer token in">
              <button id="rui-reload" class="rules-btn">Reload</button>
            </div>
            <div id="rui-groups"></div>
          </div>
        </div>
      `;
      root.querySelector('#rui-token').value = cfg.token;
      root.querySelector('#rui-reload').addEventListener('click', () => loadAll(cfg));
      loadAll(cfg); // initial

      // nieuw-offer paneel – optioneel later toevoegen
    }
  };

  function hdrs() {
    const t = document.querySelector('#rui-token').value.trim();
    return { 'X-Admin-Token': t, 'Content-Type': 'application/json' };
  }

  // description helpers
  const readDesc = (item) =>
    item?.description ?? item?.Omschrijving ?? item?.omschrijving ?? item?.Beschrijving ?? item?.beschrijving ?? '';
  const writeDesc = (payload) => {
    const d = payload?.description ?? payload?.Omschrijving ?? payload?.omschrijving ?? payload?.Beschrijving ?? payload?.beschrijving ?? null;
    const out = { ...payload };
    delete out.description; delete out.omschrijving; delete out.beschrijving; delete out.Beschrijving;
    if (d !== null) out.description = d;
    return out;
  };

  async function loadAll(cfg) {
    const host = document.querySelector('#rui-groups');
    host.innerHTML = `<div class="rules-empty">Laden…</div>`;
    try {
      const r = await fetch(cfg.apiRules, { headers: hdrs() });
      if (!r.ok) throw new Error(await r.text().catch(() => r.status));
      const j = await r.json();
      const items = j.items || [];

      const groups = groupByOffer(items);
      const keys = Object.keys(groups).sort(offerSort);

      if (!keys.length) {
        host.innerHTML = `<div class="rules-empty">Geen regels</div>`;
        return;
      }

      host.innerHTML = '';
      for (const key of keys) {
        host.appendChild(renderGroup(cfg, key, groups[key]));
      }
    } catch (e) {
      host.innerHTML = `<div class="rules-empty" style="color:#d92d20">Error: ${String(e)}</div>`;
    }
  }

  function groupByOffer(items) {
    const m = {};
    for (const it of items) {
      const offer = (it.offer_id === '' || it.offer_id == null) ? '—' : String(it.offer_id);
      (m[offer] ||= []).push(it);
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

  function renderGroup(cfg, offerKey, items) {
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
                <th>% Accept</th>
                <th>Priority</th>
                <th>Active</th>
                <th style="width:160px">Actie</th>
              </tr>
            </thead>
            <tbody>${items.map(rowHtml).join('')}</tbody>
          </table>
        </div>

        <div class="newbar">
          <input class="rules-input w-lg" type="text" data-new="description" placeholder="Omschrijving">
          <input class="rules-input w-sm" type="text" data-new="affiliate_id" placeholder="Affiliate ID (leeg=any)">
          <input class="rules-input w-sm" type="text" data-new="sub_id" placeholder="Sub ID (leeg of 'null')">
          <input class="rules-input w-xs" type="number" data-new="percent_accept" placeholder="% Accept" value="50" min="0" max="100">
          <input class="rules-input w-xs" type="number" data-new="priority" placeholder="Priority" value="100">
          <label><input class="chk" type="checkbox" data-new="active" checked> Active</label>
          <button class="rules-btn ok" data-role="add">Toevoegen</button>
        </div>
        <div class="hint">Tip: Sub ID “<b>null</b>” target “geen sub”. Laat Affiliate leeg voor generiek binnen dit offer. Laat offer leeg via groep “ANY/Global”.</div>
      </div>
    `;

    el.querySelector('[data-role=toggle]').addEventListener('click', () => el.classList.toggle('collapsed'));

    // row actions
    el.querySelector('tbody').addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-act]'); if (!btn) return;
      const tr = btn.closest('tr'); const id = tr?.dataset?.id; if (!id) return;

      if (btn.dataset.act === 'delete') {
        if (!confirm('Deze regel verwijderen?')) return;
        const r = await fetch(`${cfg.apiRules}/${id}`, { method: 'DELETE', headers: hdrs() });
        if (r.status === 204) { await reloadGroups(cfg); } else { alert('Delete failed: ' + await r.text()); }
        return;
      }

      if (btn.dataset.act === 'save') {
        const payload = collectRow(tr);
        const body = writeDesc(payload);
        const r = await fetch(`${cfg.apiRules}/${id}`, { method: 'PATCH', headers: hdrs(), body: JSON.stringify(body) });
        if (r.ok) { await reloadGroups(cfg); } else { alert('Save failed: ' + await r.text()); }
      }
    });

    // add rule in group (offer fixed by group)
    el.querySelector('[data-role=add]').addEventListener('click', async () => {
      const bar = el.querySelector('.newbar');
      const p = {
        description: val(bar, 'description'),
        affiliate_id: emptyToNull(val(bar, 'affiliate_id')),
        offer_id: (offerKey === '—' ? null : offerKey),
        sub_id: normalizeSub(val(bar, 'sub_id')),
        percent_accept: Number(val(bar, 'percent_accept') || 0),
        priority: Number(val(bar, 'priority') || 100),
        active: !!bar.querySelector('[data-new=active]').checked
      };
      const body = writeDesc(p);
      const r = await fetch(`${cfg.apiRules}`, { method: 'POST', headers: hdrs(), body: JSON.stringify(body) });
      if (r.ok) { await reloadGroups(cfg); } else { alert('Create failed: ' + await r.text()); }
    });

    return el;
  }

  function rowHtml(it) {
    const esc = (s) => (s ?? '').toString().replace(/"/g, '&quot;');
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
    const q = (sel) => tr.querySelector(sel);
    const get = (k) => q(`input[data-k="${k}"]`);
    return {
      description: get('description').value,
      affiliate_id: emptyToNull(get('affiliate_id').value),
      sub_id: normalizeSub(get('sub_id').value),
      percent_accept: Number(get('percent_accept').value || 0),
      priority: Number(get('priority').value || 100),
      active: q('input[data-k="active"]').checked
    };
  }

  // utils
  const emptyToNull = (v) => (v === '' ? null : v);
  const normalizeSub = (v) => (v === '' ? null : (v === 'null' ? null : v));
  const val = (root, name) => (root.querySelector(`[data-new="${name}"]`)?.value ?? '');
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  async function reloadGroups(cfg) { await loadAll(cfg); }

  global.RulesUI = RulesUI;
})(window);
