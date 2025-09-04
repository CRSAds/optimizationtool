(function(global){
  const RulesUI = {
    init(opts){
      const cfg = {
        mount: opts.mount || '#rules-app',
        token: opts.token || '',
        apiBase: (opts.apiBase || '').replace(/\/+$/,'')
      };
      cfg.apiRules = cfg.apiBase + '/rules';

      const root = document.querySelector(cfg.mount);
      if(!root){ console.error('RulesUI: mount not found'); return; }

      root.innerHTML = `
        <div class="rules-wrap">
          <div class="rules-title">
            <h1>Optimization Rules</h1>
          </div>
          <p class="rules-sub">Beheer acceptatie-regels per offer. Klik een offer om de onderliggende affiliate/sub-regels in te klappen of uit te klappen.</p>

          <div class="rules-card">
            <div class="rules-toolbar">
              <div class="rules-label">Admin API • X-Admin-Token</div>
              <input id="rui-token" class="rules-input" type="password" style="width:260px" placeholder="••••••••">
              <button id="rui-reload" class="rules-btn">Reload</button>
            </div>
            <div id="rui-groups"><div class="rules-empty">Laden…</div></div>
          </div>

          <!-- Nieuw offer-paneel -->
          <div class="new-offer-panel" id="rui-new-offer">
            <h3>Nieuwe offer-regel</h3>

            <div class="field">
              <label>Offer ID (verplicht voor offer-groep)</label>
              <input class="rules-input" type="text" data-new-offer="offer_id" placeholder="bijv. 999">
            </div>
            <div class="field">
              <label>Omschrijving</label>
              <input class="rules-input" type="text" data-new-offer="description" placeholder="korte omschrijving">
            </div>
            <div class="field">
              <label>Affiliate ID (optioneel)</label>
              <input class="rules-input" type="text" data-new-offer="affiliate_id" placeholder="leeg = any">
            </div>
            <div class="field">
              <label>Sub ID (optioneel)</label>
              <input class="rules-input" type="text" data-new-offer="sub_id" placeholder="leeg of 'null'">
            </div>
            <div class="field" style="width:110px">
              <label>% Accept</label>
              <input class="rules-input" type="number" min="0" max="100" value="50" data-new-offer="percent_accept">
            </div>
            <div class="field" style="width:110px">
              <label>Priority</label>
              <input class="rules-input" type="number" value="100" data-new-offer="priority">
            </div>
            <label style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <input class="chk" type="checkbox" data-new-offer="active" checked> Active
            </label>

            <button class="rules-btn ok" id="rui-add-offer">Toevoegen</button>
          </div>
        </div>
      `;

      root.querySelector('#rui-token').value = cfg.token;
      root.querySelector('#rui-reload').addEventListener('click', ()=> loadAll(cfg));
      root.querySelector('#rui-add-offer').addEventListener('click', ()=> addOfferRule(cfg));
      loadAll(cfg);
    }
  };

  /* -------------- helpers -------------- */
  const qs = (sel, root=document)=> root.querySelector(sel);
  const qsa = (sel, root=document)=> Array.from(root.querySelectorAll(sel));
  const hdrs = ()=> ({ 'X-Admin-Token': qs('#rui-token').value.trim(), 'Content-Type':'application/json' });

  // Backwards compatible description mapping (schrijf als "description")
  const readDesc = it => it?.description ?? it?.Omschrijving ?? it?.omschrijving ?? it?.Beschrijving ?? it?.beschrijving ?? '';
  const writeDesc = p => {
    const d = p?.description ?? p?.Omschrijving ?? p?.omschrijving ?? p?.Beschrijving ?? p?.beschrijving ?? null;
    const out = {...p};
    delete out.Omschrijving; delete out.omschrijving; delete out.Beschrijving; delete out.beschrijving;
    if(d!==null) out.description = d;
    return out;
  };

  function groupByOffer(items){
    const map = {};
    for(const it of items){
      const key = (it.offer_id==='' || it.offer_id==null) ? '—' : String(it.offer_id);
      (map[key] ||= []).push(it);
    }
    return map;
  }
  function offerSort(a,b){
    if(a==='—' && b!=='—') return 1;
    if(b==='—' && a!=='—') return -1;
    const na = Number(a), nb = Number(b);
    if(!Number.isNaN(na) && !Number.isNaN(nb)) return na-nb;
    return String(a).localeCompare(String(b));
  }

  /* -------------- load & render -------------- */
  async function loadAll(cfg){
    const host = qs('#rui-groups');
    host.innerHTML = `<div class="rules-empty">Laden…</div>`;
    try{
      const r = await fetch(cfg.apiRules, { headers: hdrs() });
      if(!r.ok) throw new Error(r.status);
      const json = await r.json();
      const items = json.items || [];
      const groups = groupByOffer(items);

      host.innerHTML = '';
      Object.keys(groups).sort(offerSort).forEach(key=>{
        host.appendChild(renderGroup(cfg, key, groups[key]));
      });

      if(!Object.keys(groups).length){
        host.innerHTML = `<div class="rules-empty">Nog geen regels</div>`;
      }
    }catch(e){
      host.innerHTML = `<div class="rules-empty" style="color:#d92d20">Error ${String(e)}</div>`;
    }
  }

  function renderGroup(cfg, offerKey, items){
    // sorteer binnen groep op priority asc, dan affiliate_id, dan sub_id
    items.sort((a,b)=>{
      const pa = Number(a.priority ?? 100), pb = Number(b.priority ?? 100);
      if(pa!==pb) return pa-pb;
      const aa = String(a.affiliate_id ?? ''), ab = String(b.affiliate_id ?? '');
      if(aa!==ab) return aa.localeCompare(ab);
      const sa = String(a.sub_id ?? ''), sb = String(b.sub_id ?? '');
      return sa.localeCompare(sb);
    });

    const el = document.createElement('div');
    el.className = 'group collapsed';
    el.innerHTML = `
      <div class="group-header" data-role="toggle">
        <span class="chev">▸</span>
        <span class="group-title">Offer: ${offerKey==='—' ? '<i>ANY/Global</i>' : escape(offerKey)}</span>
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
            <tbody>
              ${items.map(rowHtml).join('')}
            </tbody>
          </table>
        </div>

        <div class="newbar">
          <input class="rules-input w-lg" type="text"   data-new="description"    placeholder="Omschrijving">
          <input class="rules-input w-sm" type="text"   data-new="affiliate_id"   placeholder="Affiliate ID (leeg=any)">
          <input class="rules-input w-sm" type="text"   data-new="sub_id"         placeholder="Sub ID (leeg of 'null')">
          <input class="rules-input w-xs" type="number" data-new="percent_accept" placeholder="% Accept" value="50" min="0" max="100">
          <input class="rules-input w-xs" type="number" data-new="priority"       placeholder="Priority" value="100">
          <label><input class="chk" type="checkbox" data-new="active" checked> Active</label>
          <button class="rules-btn ok" data-role="add">Toevoegen</button>
        </div>
      </div>
    `;

    // toggle
    qs('[data-role=toggle]', el).addEventListener('click', ()=> el.classList.toggle('collapsed'));

    // table actions
    qs('tbody', el).addEventListener('click', async (ev)=>{
      const btn = ev.target.closest('button[data-act]'); if(!btn) return;
      const tr  = btn.closest('tr'); const id = tr?.dataset?.id; if(!id) return;

      if(btn.dataset.act==='delete'){
        if(!confirm('Deze regel verwijderen?')) return;
        const r = await fetch(`${cfg.apiRules}/${id}`, { method:'DELETE', headers: hdrs() });
        if(r.status===204){ loadAll(cfg); } else { alert('Delete failed'); }
        return;
      }
      if(btn.dataset.act==='save'){
        const payload = collectRow(tr);
        const body = writeDesc(payload);
        const r = await fetch(`${cfg.apiRules}/${id}`, { method:'PATCH', headers: hdrs(), body: JSON.stringify(body) });
        if(r.ok){ loadAll(cfg); } else { alert('Save failed'); }
      }
    });

    // inline add
    qs('[data-role=add]', el).addEventListener('click', async ()=>{
      const bar = qs('.newbar', el);
      const p = {
        description: val(bar,'description'),
        affiliate_id: emptyToNull(val(bar,'affiliate_id')),
        offer_id: (offerKey==='—' ? null : offerKey),
        sub_id: normalizeSub(val(bar,'sub_id')),
        percent_accept: Number(val(bar,'percent_accept')||0),
        priority: Number(val(bar,'priority')||100),
        active: !!qs('[data-new=active]', bar).checked
      };
      const body = writeDesc(p);
      const r = await fetch(`${cfg.apiRules}`, { method:'POST', headers: hdrs(), body: JSON.stringify(body) });
      if(r.ok){ loadAll(cfg); } else { alert('Create failed'); }
    });

    return el;
  }

  function rowHtml(it){
    const esc = s => (s ?? '').toString().replace(/"/g,'&quot;');
    return `
      <tr data-id="${it.id}">
        <td><input type="text" value="${esc(readDesc(it))}" data-k="description"></td>
        <td><input type="text" value="${esc(it.affiliate_id)}" data-k="affiliate_id"></td>
        <td><input type="text" value="${esc(it.sub_id)}" data-k="sub_id"></td>
        <td><input type="number" min="0" max="100" value="${Number(it.percent_accept ?? 0)}" data-k="percent_accept"></td>
        <td><input type="number" value="${Number(it.priority ?? 100)}" data-k="priority"></td>
        <td style="text-align:center"><input class="chk" type="checkbox" ${it.active ? 'checked':''} data-k="active"></td>
        <td class="row-actions">
          <button class="rules-btn ghost" data-act="save" type="button">Save</button>
          <button class="rules-btn danger" data-act="delete" type="button">Del</button>
        </td>
      </tr>
    `;
  }

  /* -------------- Nieuw offer-paneel (onder de tabel) -------------- */
  async function addOfferRule(cfg){
    const root = qs('#rui-new-offer');
    const get  = k => qs(`[data-new-offer="${k}"]`, root)?.value ?? '';

    const offer = get('offer_id').trim();
    if(!offer){ alert('Offer ID is verplicht.'); return; }

    const p = {
      offer_id: offer,
      description: get('description'),
      affiliate_id: emptyToNull(get('affiliate_id')),
      sub_id: normalizeSub(get('sub_id')),
      percent_accept: Number(get('percent_accept') || 0),
      priority: Number(get('priority') || 100),
      active: !!qs('[data-new-offer="active"]', root)?.checked ?? true
    };

    const body = writeDesc(p);
    const r = await fetch(`${cfg.apiRules}`, { method:'POST', headers: hdrs(), body: JSON.stringify(body) });
    if(r.ok){
      // reset naar defaults
      qsa('[data-new-offer]', root).forEach(el=>{
        if(el.type==='checkbox'){ el.checked = true; }
        else if(el.getAttribute('data-new-offer')==='percent_accept'){ el.value = 50; }
        else if(el.getAttribute('data-new-offer')==='priority'){ el.value = 100; }
        else el.value = '';
      });
      loadAll(cfg);
    }else{
      alert('Create failed');
    }
  }

  /* -------------- utilities -------------- */
  function collectRow(tr){
    const g = k => tr.querySelector(`input[data-k="${k}"]`);
    return {
      description: g('description').value,
      affiliate_id: emptyToNull(g('affiliate_id').value),
      sub_id: normalizeSub(g('sub_id').value),
      percent_accept: Number(g('percent_accept').value || 0),
      priority: Number(g('priority').value || 100),
      active: tr.querySelector('input[data-k="active"]').checked
    };
  }
  const emptyToNull = v => (v==='' ? null : v);
  const normalizeSub = v => (v==='' || v==='null' ? null : v);
  const val = (root, name)=> (root.querySelector(`[data-new="${name}"]`)?.value ?? '');
  const escape = s => String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

  // expose
  global.RulesUI = RulesUI;
})(window);
