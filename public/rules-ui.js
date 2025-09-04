(function(global){
  const RulesUI = {
    init(opts){
      const cfg = {
        mount: opts.mount || '#rules-app',
        token: opts.token || '',
        apiBase: (opts.apiBase || '').replace(/\/+$/,''),
        // endpoints
        apiRules: null,
      };
      cfg.apiRules = cfg.apiBase + '/rules';

      const root = document.querySelector(cfg.mount);
      if(!root){ console.error('RulesUI: mount not found'); return; }
      root.innerHTML = `
        <div class="rules-wrap">
          <div class="rules-card" id="rules-card">
            <div class="rules-toolbar">
              <div class="rules-label">Admin API • X-Admin-Token</div>
              <input id="rui-token" class="rules-input" type="password" style="width:280px">
              <button id="rui-reload" class="rules-btn">Reload</button>
            </div>
            <div id="rui-groups"></div>
          </div>
        </div>
      `;
      root.querySelector('#rui-token').value = cfg.token;
      root.querySelector('#rui-reload').addEventListener('click', ()=> loadAll(cfg));

      // first load
      loadAll(cfg);

      // Nieuw offer-paneel toevoegen onderaan de root
      const newOfferPanel = renderNewOfferPanel(cfg);
      root.appendChild(newOfferPanel);
    }
  };

  function hdrs(cfg){
    const t = document.querySelector('#rui-token').value.trim();
    return { 'X-Admin-Token': t, 'Content-Type':'application/json' };
  }

  // ---------- description helpers (for backwards compatibility) ----------
  const readDesc = (item)=> item?.description ?? item?.Omschrijving ?? item?.omschrijving ?? item?.Beschrijving ?? item?.beschrijving ?? '';
  const writeDesc = (payload)=>{
    const d = payload?.description ?? payload?.Omschrijving ?? payload?.omschrijving ?? payload?.Beschrijving ?? payload?.beschrijving ?? null;
    const out = {...payload};
    delete out.description; delete out.omschrijving; delete out.beschrijving; delete out.Beschrijving;
    if(d!==null) out.description = d; // schrijf expliciet als 'description' (jouw API ondersteunt dit)
    return out;
  };

  async function loadAll(cfg){
    const host = document.querySelector('#rui-groups');
    host.innerHTML = `<div class="rules-empty">Laden…</div>`;
    try{
      const r = await fetch(cfg.apiRules, { headers: hdrs(cfg) });
      if(!r.ok) throw new Error(r.status);
      const j = await r.json();
      const items = j.items || [];

      // group by offer_id (incl. null/empty = "ANY/Global")
      const groups = groupByOffer(items);

      host.innerHTML = '';
      Object.keys(groups).sort(offerSort).forEach(offerKey=>{
        const groupItems = groups[offerKey];
        host.appendChild(renderGroup(cfg, offerKey, groupItems));
      });

      if(!Object.keys(groups).length){
        host.innerHTML = `<div class="rules-empty">Geen regels</div>`;
      }
    }catch(e){
      host.innerHTML = `<div class="rules-empty" style="color:#d92d20">Error ${String(e)}</div>`;
    }
  }

  function groupByOffer(items){
    const m = {};
    for(const it of items){
      // normaliseer keys
      const offer = (it.offer_id===''||it.offer_id==null) ? '—' : String(it.offer_id);
      if(!m[offer]) m[offer] = [];
      m[offer].push(it);
    }
    return m;
  }
  function offerSort(a,b){
    // '—' (geen offer_id) achteraan
    if(a==='—' && b!=='—') return 1;
    if(b==='—' && a!=='—') return -1;
    // numeriek wanneer mogelijk
    const na = Number(a), nb = Number(b);
    if(!isNaN(na) && !isNaN(nb)) return na-nb;
    return String(a).localeCompare(String(b));
  }

  function renderGroup(cfg, offerKey, items){
    // split hoofdregels vs affiliate/sub regels? In jouw wens tonen we ALLES onder offer
    // sorteer: priority asc (sterkst eerst), dan affiliate_id, sub_id
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
        <span class="group-title">Offer: ${offerKey==='—' ? '<i>ANY/Global</i>' : escapeHtml(offerKey)}</span>
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
          <input class="rules-input w-lg"       type="text"   data-new="description"    placeholder="Omschrijving">
          <input class="rules-input w-sm"       type="text"   data-new="affiliate_id"   placeholder="Affiliate ID (leeg=any)">
          <input class="rules-input w-sm"       type="text"   data-new="sub_id"         placeholder="Sub ID (leeg of 'null')">
          <input class="rules-input w-xs"       type="number" data-new="percent_accept" placeholder="% Accept" value="50" min="0" max="100">
          <input class="rules-input w-xs"       type="number" data-new="priority"       placeholder="Priority" value="100">
          <label><input class="chk" type="checkbox" data-new="active" checked> Active</label>
          <button class="rules-btn ok" data-role="add">Toevoegen</button>
        </div>
        <div class="hint">Tip: “Sub ID = <b>null</b>” target expliciet “geen sub”. Laat Affiliate leeg voor generiek binnen dit offer. Laat offer leeg via de groep “ANY/Global”.</div>
      </div>
    `;

    // events
    el.querySelector('[data-role=toggle]').addEventListener('click', ()=> el.classList.toggle('collapsed'));
    el.querySelector('tbody').addEventListener('click', (ev)=>{
      const btn = ev.target.closest('button[data-act]'); if(!btn) return;
      const tr  = btn.closest('tr'); const id = tr?.dataset?.id;
      if(!id) return;

      if(btn.dataset.act==='delete'){
        if(!confirm('Deze regel verwijderen?')) return;
        fetch(`${cfg.apiRules}/${id}`, { method:'DELETE', headers: hdrs(cfg) })
          .then(r => r.status===204 ? location.reload() : r.text().then(t=>alert('Delete failed: '+t)))
          .catch(e => alert('Delete failed: '+e));
        return;
      }

      if(btn.dataset.act==='save'){
        const payload = collectRow(tr);
        const body = writeDesc(payload);
        fetch(`${cfg.apiRules}/${id}`, { method:'PATCH', headers: hdrs(cfg), body: JSON.stringify(body) })
          .then(r => r.ok ? location.reload() : r.text().then(t=>alert('Save failed: '+t)))
          .catch(e => alert('Save failed: '+e));
      }
    });

    // toevoegen binnen group (offer staat vast op group)
    el.querySelector('[data-role=add]').addEventListener('click', ()=>{
      const bar = el.querySelector('.newbar');
      const p = {
        description: val(bar,'description'),
        affiliate_id: emptyToNull(val(bar,'affiliate_id')),
        offer_id: (offerKey==='—' ? null : offerKey),
        sub_id: normalizeSub(val(bar,'sub_id')),
        percent_accept: Number(val(bar,'percent_accept')||0),
        priority: Number(val(bar,'priority')||100),
        active: !!bar.querySelector('[data-new=active]').checked
      };
      const body = writeDesc(p);
      fetch(`${cfg.apiRules}`, { method:'POST', headers: hdrs(cfg), body: JSON.stringify(body) })
        .then(async r=>{
          if(r.ok){ location.reload(); return; }
          const t = await r.text().catch(()=> ''); alert('Create failed: '+(t||r.status));
        })
        .catch(e=> alert('Create failed: '+e));
    });

    return el;
  }

  function rowHtml(it){
    const esc = (s)=> (s ?? '').toString().replace(/"/g, '&quot;');
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

  function collectRow(tr){
    const q = (sel)=> tr.querySelector(sel);
    const get = (k)=> q(`input[data-k="${k}"]`);
    const payload = {
      description: get('description').value,
      affiliate_id: emptyToNull(get('affiliate_id').value),
      sub_id: normalizeSub(get('sub_id').value),
      percent_accept: Number(get('percent_accept').value || 0),
      priority: Number(get('priority').value || 100),
      active: q('input[data-k="active"]').checked
    };
    return payload;
  }

  // utils
  const emptyToNull = (v)=> (v==='' ? null : v);
  const normalizeSub = (v)=> (v==='' ? null : (v==='null' ? null : v));
  const val = (root, name)=> (root.querySelector(`[data-new="${name}"]`)?.value ?? '');
  const escapeHtml = (s)=> String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  // expose
  global.RulesUI = RulesUI;
})(window);
