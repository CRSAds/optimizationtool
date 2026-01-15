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

      root.innerHTML = `
        <div class="rules-wrap">
          <div class="rules-card">
            <div class="rules-toolbar">
              <span class="rules-label">Admin API • X-Admin-Token</span>
              <input id="rui-token" class="rules-input" type="password" style="width:260px" aria-label="Admin token">
              <button id="rui-reload" class="rules-btn" type="button">Reload</button>

              <input id="f_offer" class="rules-input" placeholder="Filter: Offer ID" aria-label="Filter Offer ID">
              <input id="f_aff"   class="rules-input" placeholder="Filter: Affiliate ID" aria-label="Filter Affiliate ID">
              <input id="f_sub"   class="rules-input" placeholder="Filter: Sub ID of 'null'" aria-label="Filter Sub ID">
              <input id="f_q"     class="rules-input" placeholder="Zoek in omschrijving" aria-label="Zoek in omschrijving" style="min-width:260px">
              <label style="display:flex;align-items:center;gap:8px;margin-left:4px">
                <input id="f_active" type="checkbox" class="chk"> Alleen actieve
              </label>
            </div>
            <div id="rui-groups" aria-live="polite"></div>
          </div>
        </div>
      `;

      // token persist
      root.querySelector('#rui-token').value = cfg.token;
      root.querySelector('#rui-token').addEventListener('change', (e)=>{
        localStorage.setItem('rui_token', e.target.value.trim());
      });
      root.querySelector('#rui-reload').addEventListener('click', ()=> loadAll());

      // filters (debounced + persist) — zonder priority
      const debouncedApply = debounce(applyFilters, 160);
      ['f_offer','f_aff','f_sub','f_q','f_active'].forEach(id=>{
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
        setTimeout(()=>{ n.style.opacity='0.0'; n.style.transition='opacity .35s'; }, 2400);
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

          // groepeer op offer (null/empty → '—')
          const groups = groupByOffer(items);
          host.innerHTML = '';
          Object.keys(groups).sort(offerSort).forEach(offerKey=>{
            host.appendChild(renderGroup(offerKey, groups[offerKey]));
          });
          if(!Object.keys(groups).length){
            host.innerHTML = `<div class="rules-empty">Geen regels</div>`;
          }
          applyFilters();
        }catch(e){
          host.innerHTML = `<div class="rules-empty" style="color:#d92d20">Error ${String(e.message||e)}</div>`;
        }
      }

      function groupByOffer(items){
        const m = {};
        for(const it of items){
          const offer = (it.offer_id===''||it.offer_id==null) ? '—' : String(it.offer_id);
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

      function readDesc(it){
        return it?.description ?? it?.Omschrijving ?? it?.omschrijving ?? it?.Beschrijving ?? it?.beschrijving ?? '';
      }
      function writeDesc(p){
        const d = p?.description ?? p?.Omschrijving ?? p?.omschrijving ?? p?.Beschrijving ?? p?.beschrijving ?? null;
        const out = {...p};
        delete out.omschrijving; delete out.beschrijving; delete out.Beschrijving;
        if(d!==null) out.description = d;
        return out;
      }

      function renderGroup(offerKey, items){
        // sorteer op affiliate/sub (priority bestaat niet meer in UI)
        items.sort((a,b)=>{
          const aa = String(a.affiliate_id ?? ''), ab = String(b.affiliate_id ?? '');
          if(aa!==ab) return aa.localeCompare(ab);
          const sa = String(a.sub_id ?? ''), sb = String(b.sub_id ?? '');
          return sa.localeCompare(sb);
        });

        const el = document.createElement('div');
        el.className = 'group collapsed';
        el.dataset.offer = offerKey;

        el.innerHTML = `
          <div class="group-header" data-role="toggle" role="button" tabindex="0" aria-expanded="false">
            <span class="chev">▸</span>
            <span class="group-title">Offer: ${offerKey==='—' ? '<i>ANY/Global</i>' : escapeHtml(offerKey)}</span>
            <span class="group-sub">${items.length} regel(s)</span>
          </div>

          <div class="group-body">
            <div class="hint">Selectie van regels gebeurt automatisch op <b>meeste overeenkomende velden</b> (affiliate / offer / sub). <br>Er is <b>geen priority</b> meer in gebruik.</div>
            <div class="table-wrap">
              <table class="rules">
                <thead>
                  <tr>
                    <th>Omschrijving</th>
                    <th>Affiliate ID</th>
                    <th>Sub ID</th>
                    <th>Offer ID</th>
                    <th>% Accept (config)</th>
                    <th>Auto Pilot</th> 
                    <th>Target Marge</th> 
                    <th>Min Vol</th> 
                    <th>Active</th>
                    <th style="width:160px">Actie</th>
                  </tr>
                </thead>
                <tbody>
                  ${items.map(rowHtml).join('')}
                </tbody>
              </table>
            </div>

            <!-- Nieuwe regel -->
            <div class="newbar">
              <input class="rules-input w-desc" type="text" data-new="description" placeholder="Omschrijving">
              <input class="rules-input w-offer" type="text" value="${offerKey==='—' ? '' : escapeHtml(offerKey)}" data-new="offer_id" placeholder="Offer ID">
              <input class="rules-input w-sm"   type="text" data-new="affiliate_id" placeholder="Affiliate ID (leeg=any)">
              <input class="rules-input w-sm"   type="text" data-new="sub_id"       placeholder="Sub ID (leeg of 'null')">
              <input class="rules-input w-xs"   type="number" data-new="percent_accept" placeholder="% Accept" value="50" min="0" max="100">
              <label><input class="chk" type="checkbox" data-new="active" checked> Active</label>
              <button class="rules-btn ok" data-role="add" type="button">Toevoegen</button>
            </div>
          </div>
        `;

        // toggler
        const toggle = el.querySelector('[data-role=toggle]');
        toggle.addEventListener('click', ()=>{
          el.classList.toggle('collapsed');
          const exp = !el.classList.contains('collapsed');
          toggle.setAttribute('aria-expanded', String(exp));
          el.querySelector('.chev').style.transform = exp ? 'rotate(90deg)' : 'rotate(0deg)';
        });
        toggle.addEventListener('keydown', (e)=>{
          if(e.key==='Enter' || e.key===' '){ e.preventDefault(); toggle.click(); }
        });

        // row actions
        el.querySelector('tbody').addEventListener('click', (ev)=>{
          const btn = ev.target.closest('button[data-act]'); if(!btn) return;
          const tr  = btn.closest('tr'); const id = tr?.dataset?.id; if(!id) return;

          if(btn.dataset.act === 'delete'){
            if(!confirm('Deze regel verwijderen?')) return;
            fetch(`${cfg.apiRules}/${id}`, { method:'DELETE', headers: hdrs() })
              .then(r => r.status===204 ? location.reload() : r.text().then(t=>alert('Delete failed: '+t)))
              .catch(e => alert('Delete failed: '+e));
            return;
          }

          if(btn.dataset.act === 'save'){
            const payload = collectRow(tr);
            const body = writeDesc(payload);
            fetch(`${cfg.apiRules}/${id}`, { method:'PATCH', headers: hdrs(), body: JSON.stringify(body) })
              .then(r => r.ok ? location.reload() : r.text().then(t=>alert('Save failed: '+t)))
              .catch(e => alert('Save failed: '+e));
          }
        });

        // toevoegen
        el.querySelector('[data-role=add]').addEventListener('click', ()=>{
          const bar = el.querySelector('.newbar');
          const p = {
            description    : getNew(bar,'description'),
            affiliate_id   : emptyToNull(getNew(bar,'affiliate_id')),
            offer_id       : emptyToNull(getNew(bar,'offer_id')) || (offerKey==='—'? null : offerKey),
            sub_id         : normalizeSub(getNew(bar,'sub_id')),
            percent_accept : Number(getNew(bar,'percent_accept')||0),
            active         : bar.querySelector('[data-new=active]').checked
          };
          const body = writeDesc(p);
          fetch(cfg.apiRules, { method:'POST', headers: hdrs(), body: JSON.stringify(body) })
            .then(async r=>{
              if(r.ok){ location.reload(); return; }
              const t = await r.text().catch(()=> ''); alert('Create failed: '+(t||r.status));
            })
            .catch(e=> alert('Create failed: '+e));
        });

        return el;
      }

        function rowHtml(it){
        const esc = (s)=> (s ?? '').toString().replace(/"/g,'&quot;');
        const desc = readDesc(it);
        return `
          <tr data-id="${it.id}">
            <td><input type="text" value="${esc(desc)}" data-k="description" aria-label="Omschrijving"></td>
            <td><input type="text" value="${esc(it.affiliate_id)}" data-k="affiliate_id" aria-label="Affiliate ID"></td>
            <td><input type="text" value="${esc(it.sub_id)}" data-k="sub_id" aria-label="Sub ID"></td>
            <td><input type="text" value="${esc(it.offer_id)}" data-k="offer_id" aria-label="Offer ID"></td>
            <td><input type="number" min="0" max="100" value="${Number(it.percent_accept ?? 0)}" data-k="percent_accept" aria-label="Percent accept"></td>
            
            <td style="text-align:center">
              <input class="chk" type="checkbox" ${it.auto_pilot ? 'checked' : ''} data-k="auto_pilot" aria-label="Auto Pilot">
            </td>

            <td>
              <input type="number" step="0.1" value="${it.target_margin ?? 15}" data-k="target_margin" aria-label="Target Margin" style="width:65px">
            </td>

            <td>
              <input type="number" value="${it.min_volume ?? 20}" data-k="min_volume" aria-label="Min Volume" style="width:60px">
            </td>

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
          offer_id       : emptyToNull(get('offer_id').value),
          sub_id         : normalizeSub(get('sub_id').value),
          percent_accept : Number(get('percent_accept').value || 0),
          auto_pilot     : q('input[data-k="auto_pilot"]').checked, // NIEUW
          target_margin  : Number(get('target_margin').value || 15), // NIEUW
          min_volume     : Number(get('min_volume').value || 20),   // NIEUW
          active         : q('input[data-k="active"]').checked
        };
      }

      /* -------- Filters (client-side, zonder priority) -------- */
      function applyFilters(){
        const fOffer = (root.querySelector('#f_offer').value || '').trim();
        const fAff   = (root.querySelector('#f_aff').value || '').trim();
        const fSub   = (root.querySelector('#f_sub').value || '').trim();
        const fQ     = (root.querySelector('#f_q').value || '').toLowerCase().trim();
        const onlyA  = root.querySelector('#f_active').checked;

        root.querySelectorAll('.group').forEach(group=>{
          let visible = true;

          // Offer filter (match op group-key)
          if(fOffer){
            const key = group.dataset.offer || '';
            if(!String(key).includes(fOffer)) visible = false;
          }

          // Filter op rijen
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
            if(fQ && !desc.includes(fQ)) rowOK = false;
            if(onlyA){
              const chk = tr.querySelector('input[data-k="active"]');
              if(!chk || !chk.checked) rowOK = false;
            }
            tr.style.display = rowOK ? '' : 'none';
            if(rowOK) rowsVisible++;
          });

          // header teller bijwerken
          const meta = group.querySelector('.group-sub');
          if(meta) meta.textContent = `${rowsVisible} regel(s)`;

          // groep verbergen als niets matcht
          group.style.display = (visible && rowsVisible>0) ? '' : 'none';
        });
      }

      // utils
      function debounce(fn,ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }
      function emptyToNull(v){ return v==='' ? null : v; }
      function normalizeSub(v){ return (v==='' || v==='null') ? null : v; }
      function getNew(rootEl, name){ return rootEl.querySelector(`[data-new="${name}"]`)?.value ?? ''; }
      function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    }
  };

  global.RulesUI = RulesUI;
})(window);
