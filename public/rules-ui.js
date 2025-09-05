// /public/rules-ui.js
(function(global){
  const RulesUI = {
    init(opts){
      const cfg = {
        mount   : opts.mount || '#rules-app',
        token   : opts.token || localStorage.getItem('rui_token') || '',
        apiBase : (opts.apiBase || '').replace(/\/+$/,''),
      };
      cfg.apiRules = cfg.apiBase + '/rules';

      const root = document.querySelector(cfg.mount);
      if(!root){ console.error('RulesUI: mount not found'); return; }

      // toast host
      if(!document.getElementById('rules-toast')){
        const t = document.createElement('div');
        t.id = 'rules-toast';
        t.style.cssText = 'position:fixed;right:16px;bottom:16px;display:flex;flex-direction:column;gap:8px;z-index:99999';
        document.body.appendChild(t);
      }

      // huidig group-mode (offer | affiliate | sub)
      let groupMode = localStorage.getItem('rui_groupmode') || 'offer';

      root.innerHTML = `
        <div class="rules-wrap">
          <div class="rules-card">
            <div class="rules-toolbar">
              <span class="rules-label">Admin API • X-Admin-Token</span>
              <input id="rui-token" class="rules-input" type="password" style="width:260px" aria-label="Admin token">
              <button id="rui-reload" class="rules-btn" type="button">Reload</button>

              <!-- Group by -->
              <select id="f_groupmode" class="rules-input" style="width:170px" aria-label="Group by">
                <option value="offer">Group: Offer</option>
                <option value="affiliate">Group: Affiliate</option>
                <option value="sub">Group: Sub ID</option>
              </select>

              <!-- Bestaande filters -->
              <input id="f_offer" class="rules-input" placeholder="Filter: Offer ID" aria-label="Filter Offer ID">
              <input id="f_aff"   class="rules-input" placeholder="Filter: Affiliate ID" aria-label="Filter Affiliate ID">
              <input id="f_sub"   class="rules-input" placeholder="Filter: Sub ID of 'null'" aria-label="Filter Sub ID">
              <input id="f_pri"   class="rules-input" placeholder="≤ Priority" type="number" min="0" aria-label="Max priority" style="width:110px">
              <input id="f_q"     class="rules-input" placeholder="Zoek in omschrijving" aria-label="Zoek in omschrijving">
              <label style="display:flex;align-items:center;gap:8px;margin-left:4px">
                <input id="f_active" type="checkbox" class="chk"> Alleen actieve
              </label>
            </div>
            <div id="rui-groups" aria-live="polite"></div>
          </div>
        </div>
      `;

      // token + persist
      root.querySelector('#rui-token').value = cfg.token;
      root.querySelector('#rui-token').addEventListener('change', (e)=>{
        localStorage.setItem('rui_token', e.target.value.trim());
      });
      root.querySelector('#rui-reload').addEventListener('click', ()=> loadAll());

      // set + persist groupmode
      const selMode = root.querySelector('#f_groupmode');
      selMode.value = groupMode;
      selMode.addEventListener('change', ()=>{
        groupMode = selMode.value;
        localStorage.setItem('rui_groupmode', groupMode);
        // hertekenen met nieuwe segmentatie
        loadAll();
      });

      // filters -> hertekenen (debounced + persist)
      const debouncedApply = debounce(applyFilters, 160);
      ['f_offer','f_aff','f_sub','f_pri','f_q','f_active'].forEach(id=>{
        const el = root.querySelector('#'+id);
        const key = 'rui_'+id;
        if(el.type === 'checkbox'){
          el.checked = localStorage.getItem(key) === '1';
        }else{
          el.value = localStorage.getItem(key) ?? '';
        }
        el.addEventListener('input', ()=>{
          if(el.type==='checkbox') localStorage.setItem(key, el.checked ? '1':'0');
          else localStorage.setItem(key, el.value);
          debouncedApply();
        });
        el.addEventListener('change', ()=>{
          if(el.type==='checkbox') localStorage.setItem(key, el.checked ? '1':'0');
          else localStorage.setItem(key, el.value);
          debouncedApply();
        });
      });

      // eerste load
      loadAll();

      /* ---------------- intern ---------------- */
      function toast(msg, kind='ok'){
        const host = document.getElementById('rules-toast');
        const n = document.createElement('div');
        n.textContent = msg;
        n.style.cssText = `background:${kind==='ok'?'#10916f':'#d92d20'};color:#fff;padding:10px 12px;border-radius:10px;box-shadow:0 6px 20px rgb(2 6 23 / .12);font-size:14px`;
        host.appendChild(n);
        requestAnimationFrame(()=>{ n.style.transition='opacity .35s, transform .35s'; n.style.opacity='1'; n.style.transform='translateY(0)'; });
        setTimeout(()=>{ n.style.opacity='0'; n.style.transform='translateY(6px)'; }, 2400);
        setTimeout(()=>{ host.removeChild(n); }, 3000);
      }

      function hdrs(){
        const t = root.querySelector('#rui-token').value.trim();
        return { 'X-Admin-Token': t, 'Content-Type':'application/json', 'Accept':'application/json' };
      }

      async function loadAll(){
        const host = root.querySelector('#rui-groups');
        host.innerHTML = `<div class="rules-empty">Laden…</div>`;
        try{
          const r = await fetch(cfg.apiRules, { headers: hdrs() });
          if(!r.ok) throw new Error(r.status+' '+r.statusText);
          const j = await r.json();
          const items = j.items || [];

          const groups = groupBy(items, groupMode);
          host.innerHTML = '';

          const keys = Object.keys(groups).sort((a,b)=> groupKeySort(a,b));
          keys.forEach(k=>{
            host.appendChild(renderGroup(k, groups[k], groupMode));
          });

          if(!keys.length){
            host.innerHTML = `<div class="rules-empty">Geen regels</div>`;
          }

          // Paneel voor nieuwe regel (incl. nieuw offer)
          host.appendChild(renderNewOfferPanel());

          applyFilters();
        }catch(e){
          host.innerHTML = `<div class="rules-empty" style="color:#d92d20">Error ${String(e.message||e)}</div>`;
        }
      }

      /* ---------- grouping helpers ---------- */
      function groupKeyFor(it, mode){
        let v;
        if(mode==='affiliate') v = it.affiliate_id;
        else if(mode==='sub')  v = it.sub_id;
        else v = it.offer_id; // default offer
        return (v===''||v==null) ? '—' : String(v);
      }
      function groupLabel(mode){
        if(mode==='affiliate') return 'Affiliate';
        if(mode==='sub') return 'Sub';
        return 'Offer';
      }
      function groupBy(items, mode){
        const m = {};
        for(const it of items){
          const k = groupKeyFor(it, mode);
          (m[k] ||= []).push(it);
        }
        return m;
      }
      function groupKeySort(a,b){
        // ‘—’ (global/any) onderaan
        if(a==='—' && b!=='—') return 1;
        if(b==='—' && a!=='—') return -1;
        const na = Number(a), nb = Number(b);
        if(!Number.isNaN(na) && !Number.isNaN(nb)) return na-nb;
        return String(a).localeCompare(String(b), 'nl');
      }

      function readDesc(it){
        return it?.description ?? it?.Omschrijving ?? it?.omschrijving ?? it?.Beschrijving ?? it?.beschrijving ?? '';
      }
      function writeDesc(p){
        const d = p?.description ?? p?.Omschrijving ?? p?.omschrijving ?? p?.Beschrijving ?? p?.beschrijving ?? null;
        const out = {...p};
        delete out.omschrijving; delete out.beschrijving; delete out.Beschrijving; delete out.Omschrijving;
        if(d!==null) out.description = d;
        return out;
      }

      function renderGroup(groupKey, items, mode){
        // sorteer binnen groep
        items.sort((a,b)=>{
          const pa = Number(a.priority ?? 100), pb = Number(b.priority ?? 100);
          if(pa!==pb) return pa-pb;
          // dan affiliate, sub, offer consistent
          const aa = String(a.affiliate_id ?? ''), ab = String(b.affiliate_id ?? '');
          if(aa!==ab) return aa.localeCompare(ab, 'nl');
          const sa = String(a.sub_id ?? ''), sb = String(b.sub_id ?? '');
          if(sa!==sb) return sa.localeCompare(sb, 'nl');
          const oa = String(a.offer_id ?? ''), ob = String(b.offer_id ?? '');
          return oa.localeCompare(ob, 'nl');
        });

        const el = document.createElement('div');
        el.className = 'group collapsed';
        el.dataset.group = groupKey;      // generieke data attribuut
        el.dataset.mode  = mode;          // onthoud mode voor filters

        const title = `${groupLabel(mode)}: ${groupKey==='—' ? '<i>ANY/Global</i>' : escapeHtml(groupKey)}`;

        el.innerHTML = `
          <div class="group-header" data-role="toggle" role="button" tabindex="0" aria-expanded="false" aria-controls="body-${cssId(mode+'-'+groupKey)}">
            <span class="chev">▸</span>
            <span class="group-title">${title}</span>
            <span class="group-sub">${items.length} regel(s)</span>
          </div>

          <div class="group-body" id="body-${cssId(mode+'-'+groupKey)}">
            <div class="table-wrap">
              <table class="rules">
                <thead>
                  <tr>
                    <th>Omschrijving</th>
                    <th>Affiliate ID</th>
                    <th>Sub ID</th>
                    <th>Offer ID</th>
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

            ${renderNewbarRowHtml(mode, groupKey)}
            <div class="hint">Tip: priority laag = sterk. “—” betekent ANY/Global.</div>
          </div>
        `;

        // open/close + keyboard
        const toggle = el.querySelector('[data-role=toggle]');
        toggle.addEventListener('click', ()=> {
          el.classList.toggle('collapsed');
          const exp = !el.classList.contains('collapsed');
          toggle.setAttribute('aria-expanded', String(exp));
          el.querySelector('.chev').style.transform = exp ? 'rotate(90deg)' : 'rotate(0deg)';
        });
        toggle.addEventListener('keydown', (e)=>{
          if(e.key==='Enter' || e.key===' '){ e.preventDefault(); toggle.click(); }
        });

        // opslaan/verwijderen
        el.querySelector('tbody').addEventListener('click', async (ev)=>{
          const btn = ev.target.closest('button[data-act]'); if(!btn) return;
          const tr  = btn.closest('tr'); const id = tr?.dataset?.id; if(!id) return;

          if(btn.dataset.act === 'delete'){
            if(!confirm('Deze regel verwijderen?')) return;
            const r = await fetch(`${cfg.apiRules}/${encodeURIComponent(id)}`, { method:'DELETE', headers: hdrs() });
            if(r.status===204){ tr.remove(); updateGroupMeta(el); toast('Verwijderd'); return; }
            const t = await safeText(r); toast('Delete failed: '+(t||r.status), 'err'); return;
          }

          if(btn.dataset.act === 'save'){
            const payload = collectRow(tr);
            const body = writeDesc(payload);
            const val = validateRow(body);
            if(val!==true){ toast(val, 'err'); return; }
            const r = await fetch(`${cfg.apiRules}/${encodeURIComponent(id)}`, { method:'PATCH', headers: hdrs(), body: JSON.stringify(body) });
            if(r.ok){ toast('Opgeslagen'); return; }
            const t = await safeText(r); toast('Save failed: '+(t||r.status), 'err');
          }
        });

        // toevoegen (per mode variabel wat vast staat)
        const addBtn = el.querySelector('[data-role=add]');
        addBtn.addEventListener('click', async ()=>{
          const row = el.querySelector('.newbar__row');
          const p = {
            description    : getNew(row,'description'),
            affiliate_id   : emptyToNull(getNew(row,'affiliate_id')),
            offer_id       : emptyToNull(getNew(row,'offer_id')),
            sub_id         : normalizeSub(getNew(row,'sub_id')),
            percent_accept : Number(getNew(row,'percent_accept')||0),
            priority       : Number(getNew(row,'priority')||100),
            active         : row.querySelector('[data-new=active]').checked
          };

          // veranker veld obv mode
          if(mode==='offer'){ p.offer_id = (groupKey==='—' ? null : groupKey); }
          if(mode==='affiliate'){ p.affiliate_id = (groupKey==='—' ? null : groupKey); }
          if(mode==='sub'){ p.sub_id = (groupKey==='—' ? null : groupKey); }

          const body = writeDesc(p);
          const val = validateRow(body);
          if(val!==true){ toast(val, 'err'); return; }

          const r = await fetch(cfg.apiRules, { method:'POST', headers: hdrs(), body: JSON.stringify(body) });
          if(r.ok){ toast('Aangemaakt'); loadAll(); return; }
          const t = await safeText(r); toast('Create failed: '+(t||r.status), 'err');
        });

        return el;
      }

      function renderNewbarRowHtml(mode, groupKey){
        // Toon inputs dynamisch: het veld van de grouping staat vast (disabled/placeholder)
        const lockHtml = (label, fixed, key) => {
          const val = fixed==='—' ? '' : escapeAttr(fixed);
          return `<input class="rules-input w-sm" type="text" data-new="${key}" placeholder="${label}${fixed==='—'?' (ANY)':''}" value="${val}" ${fixed==='—'?'':'disabled'}>`;
        };
        const freeHtml = (label, key, extra='w-sm', type='text', minmax='') => {
          return `<input class="rules-input ${extra}" type="${type}" ${minmax} data-new="${key}" placeholder="${label}">`;
        };

        let line = '';
        if(mode==='offer'){
          line = `
            ${lockHtml('Offer ID', groupKey, 'offer_id')}
            ${freeHtml('Affiliate ID (leeg=any)','affiliate_id')}
            ${freeHtml("Sub ID (leeg of 'null')",'sub_id')}
          `;
        }else if(mode==='affiliate'){
          line = `
            ${lockHtml('Affiliate ID', groupKey, 'affiliate_id')}
            ${freeHtml('Offer ID (leeg=ANY)','offer_id')}
            ${freeHtml("Sub ID (leeg of 'null')",'sub_id')}
          `;
        }else{
          line = `
            ${lockHtml('Sub ID', groupKey, 'sub_id')}
            ${freeHtml('Offer ID (leeg=ANY)','offer_id')}
            ${freeHtml('Affiliate ID (leeg=any)','affiliate_id')}
          `;
        }

        return `
          <div class="newbar">
            <div class="newbar__scroll">
              <div class="newbar__row" style="display:flex;gap:8px;align-items:center;min-width:900px">
                <input class="rules-input w-desc" type="text" data-new="description" placeholder="Omschrijving">
                ${line}
                <input class="rules-input w-xs" type="number" data-new="percent_accept" placeholder="% Accept" value="50" min="0" max="100">
                <input class="rules-input w-xs" type="number" data-new="priority" placeholder="Priority" value="100" min="0">
                <label><input class="chk" type="checkbox" data-new="active" checked> Active</label>
                <button class="rules-btn ok" data-role="add" type="button">Toevoegen</button>
              </div>
            </div>
          </div>
        `;
      }

      function renderNewOfferPanel(){
        const el = document.createElement('div');
        el.className = 'new-offer-panel';
        el.innerHTML = `
          <h3>Nieuwe regel toevoegen (nieuw offer kan hier ook)</h3>
          <input class="rules-input w-offer" type="text" data-new="offer_id" placeholder="Offer ID (leeg = ANY)">
          <input class="rules-input w-desc"  type="text" data-new="description" placeholder="Omschrijving">
          <input class="rules-input w-sm"   type="text" data-new="affiliate_id" placeholder="Affiliate ID (leeg=any)">
          <input class="rules-input w-sm"   type="text" data-new="sub_id" placeholder="Sub ID (leeg of 'null')">
          <input class="rules-input w-xs"   type="number" data-new="percent_accept" placeholder="% Accept" value="50" min="0" max="100">
          <input class="rules-input w-xs"   type="number" data-new="priority" placeholder="Priority" value="100" min="0">
          <label><input class="chk" type="checkbox" data-new="active" checked> Active</label>
          <button class="rules-btn ok" type="button" data-role="create-offer">Toevoegen</button>
        `;

        el.querySelector('[data-role="create-offer"]').addEventListener('click', async ()=>{
          const q = (k)=> el.querySelector(`[data-new="${k}"]`);
          const p = {
            description    : (q('description').value || '').trim(),
            affiliate_id   : emptyToNull(q('affiliate_id').value),
            offer_id       : emptyToNull(q('offer_id').value),
            sub_id         : normalizeSub(q('sub_id').value),
            percent_accept : Number(q('percent_accept').value || 0),
            priority       : Number(q('priority').value || 100),
            active         : q('active').checked
          };
          const body = writeDesc(p);
          const val = validateRow(body);
          if(val!==true){ toast(val, 'err'); return; }

          try{
            const r = await fetch(cfg.apiRules, { method:'POST', headers: hdrs(), body: JSON.stringify(body) });
            if(!r.ok){ const t = await safeText(r); throw new Error(t||r.status); }
            toast('Regel aangemaakt');
            ['offer_id','description','affiliate_id','sub_id'].forEach(k=> q(k).value='');
            q('percent_accept').value = 50; q('priority').value = 100; q('active').checked = true;
            loadAll();
          }catch(e){
            toast('Create failed: '+String(e.message||e), 'err');
          }
        });

        return el;
      }

      function updateGroupMeta(groupEL){
        const rowsVisible = [...groupEL.querySelectorAll('tbody tr')].filter(tr=> tr.style.display !== 'none').length;
        const meta = groupEL.querySelector('.group-sub');
        if(meta) meta.textContent = `${rowsVisible} regel(s)`;
        if(rowsVisible===0) groupEL.style.display='none';
      }

      function rowHtml(it){
        const desc = readDesc(it);
        return `
          <tr data-id="${escapeAttr(it.id)}">
            <td><input type="text" value="${escapeAttr(desc)}" data-k="description" aria-label="Omschrijving"></td>
            <td><input type="text" value="${escapeAttr(it.affiliate_id ?? '')}" data-k="affiliate_id" aria-label="Affiliate ID"></td>
            <td><input type="text" value="${escapeAttr(it.sub_id ?? '')}" data-k="sub_id" aria-label="Sub ID"></td>
            <td><input type="text" value="${escapeAttr(it.offer_id ?? '')}" data-k="offer_id" aria-label="Offer ID"></td>
            <td><input type="number" min="0" max="100" value="${Number(it.percent_accept ?? 0)}" data-k="percent_accept" aria-label="Percent accept"></td>
            <td><input type="number" min="0" value="${Number(it.priority ?? 100)}" data-k="priority" aria-label="Priority"></td>
            <td style="text-align:center"><input class="chk" type="checkbox" ${it.active ? 'checked' : ''} data-k="active" aria-label="Active"></td>
            <td class="row-actions">
              <button class="rules-btn ghost"  data-act="save"   type="button">Save</button>
              <button class="rules-btn danger" data-act="delete" type="button">Del</button>
            </td>
          </tr>
        `;
      }

      function collectRow(tr){
        const q = (sel)=> tr.querySelector(sel);
        const get = (k)=> q(`input[data-k="${k}"]`);
        return {
          description    : get('description').value,
          affiliate_id   : emptyToNull(get('affiliate_id').value),
          sub_id         : normalizeSub(get('sub_id').value),
          offer_id       : emptyToNull(get('offer_id').value),
          percent_accept : Number(get('percent_accept').value || 0),
          priority       : Number(get('priority').value || 100),
          active         : q('input[data-k="active"]').checked
        };
      }

      /* -------- Filters (client-side) -------- */
      function applyFilters(){
        // Kies welk group-filter we gebruiken obv mode:
        // - offer mode → f_offer
        // - affiliate mode → f_aff
        // - sub mode → f_sub
        const fGroup =
          (localStorage.getItem('rui_groupmode')==='affiliate') ? (root.querySelector('#f_aff').value || '').trim() :
          (localStorage.getItem('rui_groupmode')==='sub') ? (root.querySelector('#f_sub').value || '').trim() :
          (root.querySelector('#f_offer').value || '').trim();

        const fAff   = (root.querySelector('#f_aff').value || '').trim();
        const fSub   = (root.querySelector('#f_sub').value || '').trim();
        const fPri   = root.querySelector('#f_pri').value;
        const fQ     = (root.querySelector('#f_q').value || '').toLowerCase().trim();
        const onlyA  = root.querySelector('#f_active').checked;

        root.querySelectorAll('.group').forEach(group=>{
          let visibleGroup = true;

          // filter op group key (data-group)
          if(fGroup){
            const key = group.dataset.group || '';
            if(!String(key).includes(fGroup)) visibleGroup = false;
          }

          let rowsVisible = 0;
          group.querySelectorAll('tbody tr').forEach(tr=>{
            let rowOK = true;
            const v = (k)=> tr.querySelector(`input[data-k="${k}"]`)?.value ?? '';
            const desc = (tr.querySelector('input[data-k="description"]')?.value || '').toLowerCase();

            if(fAff && !String(v('affiliate_id')||'').includes(fAff)) rowOK = false;
            if(fSub){
              const subv = v('sub_id');
              if(fSub.toLowerCase()==='null'){
                if(subv!=='' && subv!==null) rowOK = false;
              }else if(!String(subv||'').includes(fSub)) rowOK = false;
            }
            if(fPri && Number(v('priority')||999999) > Number(fPri)) rowOK = false;
            if(fQ && !desc.includes(fQ)) rowOK = false;
            if(onlyA){
              const chk = tr.querySelector('input[data-k="active"]');
              if(!chk || !chk.checked) rowOK = false;
            }
            tr.style.display = rowOK ? '' : 'none';
            if(rowOK) rowsVisible++;
          });

          const meta = group.querySelector('.group-sub');
          if(meta) meta.textContent = `${rowsVisible} regel(s)`;
          group.style.display = (visibleGroup && rowsVisible>0) ? '' : 'none';
        });
      }

      // utils
      function emptyToNull(v){ return v==='' ? null : v; }
      function normalizeSub(v){ if(v===''||v==null) return null; return String(v).toLowerCase()==='null' ? null : v; }
      function getNew(rootEl, name){ return rootEl.querySelector(`[data-new="${name}"]`)?.value ?? ''; }

      function escapeHtml(s){
        const map = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
        return String(s).replace(/[&<>"']/g, ch => map[ch]);
      }
      function escapeAttr(s){ return escapeHtml(s); }
      function cssId(s){ return String(s).replace(/\s+/g,'-').replace(/[^a-zA-Z0-9_-]/g,''); }
      function debounce(fn, ms){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn.apply(null,args), ms); }; }
      async function safeText(r){ try{ return await r.text(); }catch{ return ''; } }
      function validateRow(p){
        if(!p.description || !p.description.trim()) return 'Omschrijving is verplicht';
        const pct = Number(p.percent_accept);
        if(Number.isNaN(pct) || pct<0 || pct>100) return '% Accept moet 0–100 zijn';
        const pri = Number(p.priority);
        if(Number.isNaN(pri) || pri<0) return 'Priority moet ≥ 0 zijn';
        return true;
      }
    }
  };

  global.RulesUI = RulesUI;
})(window);
