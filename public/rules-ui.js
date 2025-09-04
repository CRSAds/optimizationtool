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
          <div class="rules-card" id="rules-card">
            <div class="rules-toolbar">
              <div class="rules-label">Admin API • X-Admin-Token</div>
              <input id="rui-token" class="rules-input" type="password" style="width:280px" />
              <button id="rui-reload" class="rules-btn" type="button">Reload</button>
            </div>
            <div id="rui-groups"></div>
          </div>
        </div>
      `;
      root.querySelector('#rui-token').value = cfg.token;
      root.querySelector('#rui-reload').addEventListener('click', ()=> loadAll(cfg));
      loadAll(cfg);
    }
  };

  // ---------- helpers ----------
  const qs = (s, el=document)=> el.querySelector(s);
  const hdrs = ()=> ({ 'X-Admin-Token': qs('#rui-token').value.trim(), 'Content-Type':'application/json' });
  const esc  = (s)=> String(s ?? '').replace(/[&<>"']/g, m=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const emptyToNull = (v)=> (v==='' ? null : v);
  const normalizeSub = (v)=> (v==='' ? null : (v==='null' ? null : v));

  // beschrijving compat
  const readDesc  = (item)=> item?.description ?? item?.Omschrijving ?? item?.omschrijving ?? item?.Beschrijving ?? item?.beschrijving ?? '';
  const writeDesc = (payload)=>{
    const d = payload?.description ?? payload?.Omschrijving ?? payload?.omschrijving ?? payload?.Beschrijving ?? payload?.beschrijving ?? null;
    const out = {...payload};
    delete out.Omschrijving; delete out.omschrijving; delete out.Beschrijving; delete out.beschrijving;
    if(d!==null) out.description = d;
    return out;
  };

  // onthoud open/dicht per offerKey
  const keyFor = (offerKey)=> `rules_open_${offerKey}`;
  const isOpen = (offerKey)=> sessionStorage.getItem(keyFor(offerKey)) === '1';
  const setOpen = (offerKey, val)=> sessionStorage.setItem(keyFor(offerKey), val ? '1' : '0');

  async function loadAll(cfg){
    const host = qs('#rui-groups');
    host.innerHTML = `<div class="rules-empty">Laden…</div>`;
    try{
      const r = await fetch(cfg.apiRules, { headers: hdrs() });
      if(!r.ok) throw new Error(r.status);
      const j = await r.json();
      const items = j.items || [];

      const groups = groupByOffer(items);
      const offerKeys = Object.keys(groups).sort(offerSort);

      host.innerHTML = '';
      if(!offerKeys.length){
        host.innerHTML = `<div class="rules-empty">Geen regels</div>`;
        return;
      }
      for(const offerKey of offerKeys){
        host.appendChild(renderGroup(cfg, offerKey, groups[offerKey]));
      }
    }catch(e){
      host.innerHTML = `<div class="rules-empty" style="color:#d92d20">Error ${esc(String(e))}</div>`;
    }
  }

  function groupByOffer(items){
    const m = {};
    for(const it of items){
      const offer = (it.offer_id==='' || it.offer_id==null) ? '—' : String(it.offer_id);
      (m[offer] ||= []).push(it);
    }
    return m;
  }
  function offerSort(a,b){
    if(a==='—' && b!=='—') return 1;
    if(b==='—' && a!=='—') return -1;
    const na = Number(a), nb = Number(b);
    if(!Number.isNaN(na) && !Number.isNaN(nb)) return na-nb;
    return String(a).localeCompare(String(b));
  }

  function renderGroup(cfg, offerKey, items){
    items.sort((a,b)=>{
      const pa = Number(a.priority ?? 100), pb = Number(b.priority ?? 100);
      if(pa!==pb) return pa-pb;
      const aa = String(a.affiliate_id ?? ''), ab = String(b.affiliate_id ?? '');
      if(aa!==ab) return aa.localeCompare(ab);
      const sa = String(a.sub_id ?? ''), sb = String(b.sub_id ?? '');
      return sa.localeCompare(sb);
    });

    const open = isOpen(offerKey);
    const el = document.createElement('div');
    el.className = 'group' + (open ? '' : ' collapsed');
    el.innerHTML = `
      <div class="group-header" data-role="toggle">
        <span class="chev">▸</span>
        <span class="group-title">Offer: ${offerKey==='—' ? '<i>ANY/Global</i>' : esc(offerKey)}</span>
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
          <button class="rules-btn ok" data-role="add" type="button">Toevoegen</button>
        </div>
        <div class="hint">Tip: “Sub ID = <b>null</b>” target expliciet “geen sub”.</div>
      </div>
    `;

    // toggling + state bewaren
    el.querySelector('[data-role=toggle]').addEventListener('click', ()=>{
      const willOpen = el.classList.toggle('collapsed') ? 0 : 1;
      setOpen(offerKey, !!willOpen);
    });

    // table actions
    el.querySelector('tbody').addEventListener('click', async (ev)=>{
      const btn = ev.target.closest('button[data-act]'); if(!btn) return;
      const tr  = btn.closest('tr'); const id = tr?.dataset?.id; if(!id) return;

      if(btn.dataset.act==='delete'){
        if(!confirm('Deze regel verwijderen?')) return;
        const r = await fetch(`${cfg.apiRules}/${id}`, { method:'DELETE', headers: hdrs() });
        if(r.status===204){ await loadAll(cfg); } else { alert('Delete failed'); }
        return;
      }
      if(btn.dataset.act==='save'){
        const payload = collectRow(tr);
        const body = writeDesc(payload);
        const r = await fetch(`${cfg.apiRules}/${id}`, { method:'PATCH', headers: hdrs(), body: JSON.stringify(body) });
        if(r.ok){ await loadAll(cfg); } else { alert('Save failed'); }
      }
    });

    // add inside group (offer vast)
    el.querySelector('[data-role=add]').addEventListener('click', async ()=>{
      const bar = el.querySelector('.newbar');
      const p = {
        description: bar.querySelector('[data-new="description"]').value,
        affiliate_id: emptyToNull(bar.querySelector('[data-new="affiliate_id"]').value),
        offer_id: (offerKey==='—' ? null : offerKey),
        sub_id: normalizeSub(bar.querySelector('[data-new="sub_id"]').value),
        percent_accept: Number(bar.querySelector('[data-new="percent_accept"]').value || 0),
        priority: Number(bar.querySelector('[data-new="priority"]').value || 100),
        active: !!bar.querySelector('[data-new="active"]').checked
      };
      const body = writeDesc(p);
      const r = await fetch(`${cfg.apiRules}`, { method:'POST', headers: hdrs(), body: JSON.stringify(body) });
      if(r.ok){ await loadAll(cfg); }
      else { alert('Create failed'); }
    });

    return el;
  }

  function rowHtml(it){
    const desc = readDesc(it);
    return `
      <tr data-id="${it.id}">
        <td><input type="text"   value="${esc(desc)}"                      data-k="description"></td>
        <td><input type="text"   value="${esc(it.affiliate_id ?? '')}"     data-k="affiliate_id"></td>
        <td><input type="text"   value="${esc(it.sub_id ?? '')}"           data-k="sub_id"></td>
        <td><input type="number" value="${Number(it.percent_accept ?? 0)}" data-k="percent_accept" min="0" max="100"></td>
        <td><input type="number" value="${Number(it.priority ?? 100)}"     data-k="priority"></td>
        <td style="text-align:center"><input class="chk" type="checkbox" ${it.active ? 'checked' : ''} data-k="active"></td>
        <td class="row-actions">
          <button class="rules-btn ghost"  data-act="save"   type="button">Save</button>
          <button class="rules-btn danger" data-act="delete" type="button">Del</button>
        </td>
      </tr>
    `;
  }

  function collectRow(tr){
    const g = (k)=> tr.querySelector(`input[data-k="${k}"]`);
    return {
      description: g('description').value,
      affiliate_id: emptyToNull(g('affiliate_id').value),
      sub_id: normalizeSub(g('sub_id').value),
      percent_accept: Number(g('percent_accept').value || 0),
      priority: Number(g('priority').value || 100),
      active: tr.querySelector('input[data-k="active"]').checked
    };
  }

  // expose
  global.RulesUI = RulesUI;
})(window);
