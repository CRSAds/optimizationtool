(function(global){
  const RulesUI = {
    init(opts){
      const cfg = {
        mount   : opts.mount || '#rules-app',
        token   : opts.token || '',
        apiBase : (opts.apiBase || '').replace(/\/+$/,''),
      };
      cfg.apiRules = cfg.apiBase + '/rules';

      const root = document.querySelector(cfg.mount);
      if(!root){ console.error('RulesUI: mount not found'); return; }

      root.innerHTML = `
        <div class="rui-wrap">
          <div class="rui-card">
            <div class="rui-toolbar">
              <span class="rui-label">Admin API • X-Admin-Token</span>
              <input id="rui-token" class="rui-input" type="password" style="width:260px">
              <button id="rui-reload" class="rui-btn">Reload</button>

              <input id="f_offer" class="rui-input rui-input--sm" placeholder="Filter: Offer ID">
              <input id="f_aff"   class="rui-input rui-input--sm" placeholder="Filter: Affiliate ID">
              <input id="f_sub"   class="rui-input rui-input--sm" placeholder="Filter: Sub ID of 'null'">
              <input id="f_pri"   class="rui-input rui-input--xs" placeholder="≤ Priority" type="number" min="0">
              <input id="f_q"     class="rui-input" placeholder="Zoek in omschrijving">
              <label style="display:flex;align-items:center;gap:8px;margin-left:4px">
                <input id="f_active" type="checkbox" class="rui-chk"> Alleen actieve
              </label>
            </div>
            <div id="rui-groups"></div>
          </div>
        </div>
      `;

      root.querySelector('#rui-token').value = (opts.token || '');
      root.querySelector('#rui-reload').addEventListener('click', ()=> loadAll(cfg));

      // filters -> hertekenen
      ['f_offer','f_aff','f_sub','f_pri','f_q','f_active'].forEach(id=>{
        root.querySelector('#'+id).addEventListener('input', ()=> applyFilters());
        root.querySelector('#'+id).addEventListener('change', ()=> applyFilters());
      });

      // eerste load
      loadAll(cfg);

      function hdrs(){
        const t = root.querySelector('#rui-token').value.trim();
        return { 'X-Admin-Token': t, 'Content-Type':'application/json' };
      }

      async function loadAll(cfg){
        const host = root.querySelector('#rui-groups');
        host.innerHTML = `<div class="rui-empty">Laden…</div>`;
        try{
          const r = await fetch(cfg.apiRules, { headers: hdrs() });
          if(!r.ok) throw new Error(r.status);
          const j = await r.json();
          const items = j.items || [];

          // groepeer op offer (null/empty → '—')
          const groups = groupByOffer(items);
          host.innerHTML = '';
          Object.keys(groups).sort(offerSort).forEach(offerKey=>{
            host.appendChild(renderGroup(offerKey, groups[offerKey]));
          });
          if(!Object.keys(groups).length){
            host.innerHTML = `<div class="rui-empty">Geen regels</div>`;
          }
          applyFilters();
        }catch(e){
          host.innerHTML = `<div class="rui-empty rui--error">Error ${String(e)}</div>`;
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
        items.sort((a,b)=>{
          const pa = Number(a.priority ?? 100), pb = Number(b.priority ?? 100);
          if(pa!==pb) return pa-pb;
          const aa = String(a.affiliate_id ?? ''), ab = String(b.affiliate_id ?? '');
          if(aa!==ab) return aa.localeCompare(ab);
          const sa = String(a.sub_id ?? ''), sb = String(b.sub_id ?? '');
          return sa.localeCompare(sb);
        });

        const el = document.createElement('div');
        el.className = 'rui-group rui--collapsed';
        el.dataset.offer = offerKey;

        el.innerHTML = `
          <div class="rui-group__header" data-role="toggle">
            <span class="rui-chev">▸</span>
            <span class="rui-group__title">Offer: ${offerKey==='—' ? '<i>ANY/Global</i>' : escapeHtml(offerKey)}</span>
            <span class="rui-group__meta">${items.length} regel(s)</span>
          </div>

          <div class="rui-group__body">
            <div class="rui-table-wrap">
              <table class="rui-table">
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

            <!-- Nieuwe regel op één rij -->
            <div class="rui-newbar">
              <div class="rui-newbar__scroll">
                <div class="rui-newbar__row" data-offer="${escapeHtml(offerKey)}">
                  <input class="rui-input"       type="text"   data-new="description"    placeholder="Omschrijving">
                  <input class="rui-input"       type="text"   data-new="affiliate_id"   placeholder="Affiliate ID (leeg=any)">
                  <input class="rui-input"       type="text"   data-new="sub_id"         placeholder="Sub ID (leeg of 'null')">
                  <input class="rui-input rui-input--xs" type="number" data-new="percent_accept" placeholder="% Accept" value="50" min="0" max="100">
                  <input class="rui-input rui-input--xs" type="number" data-new="priority"       placeholder="Priority" value="100">
                  <label><input class="rui-chk" type="checkbox" data-new="active" checked> Active</label>
                  <button class="rui-btn rui-btn--ok" data-role="add">Toevoegen</button>
                </div>
              </div>
            </div>
          </div>
        `;

        // open/close
        el.querySelector('[data-role=toggle]').addEventListener('click', ()=> el.classList.toggle('rui--collapsed'));

        // opslaan/verwijderen
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

        // toevoegen (offer is vast: group key / ‘—’ → null)
        el.querySelector('[data-role=add]').addEventListener('click', ()=>{
          const row = el.querySelector('.rui-newbar__row');
          const offerKeyHere = row.dataset.offer;
          const p = {
            description    : getNew(row,'description'),
            affiliate_id   : emptyToNull(getNew(row,'affiliate_id')),
            offer_id       : (offerKeyHere==='—' ? null : offerKeyHere),
            sub_id         : normalizeSub(getNew(row,'sub_id')),
            percent_accept : Number(getNew(row,'percent_accept')||0),
            priority       : Number(getNew(row,'priority')||100),
            active         : row.querySelector('[data-new=active]').checked
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
            <td><input type="text" value="${esc(desc)}" data-k="description"></td>
            <td><input type="text" value="${esc(it.affiliate_id)}" data-k="affiliate_id"></td>
            <td><input type="text" value="${esc(it.sub_id)}" data-k="sub_id"></td>
            <td><input type="number" min="0" max="100" value="${Number(it.percent_accept ?? 0)}" data-k="percent_accept"></td>
            <td><input type="number" value="${Number(it.priority ?? 100)}" data-k="priority"></td>
            <td style="text-align:center"><input class="rui-chk" type="checkbox" ${it.active ? 'checked' : ''} data-k="active"></td>
            <td class="rui-row-actions">
              <button class="rui-btn rui-btn--ghost"  data-act="save"   type="button">Save</button>
              <button class="rui-btn rui-btn--danger" data-act="delete" type="button">Del</button>
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
          percent_accept : Number(get('percent_accept').value || 0),
          priority       : Number(get('priority').value || 100),
          active         : q('input[data-k="active"]').checked
        };
      }

      /* -------- Filters (client-side) -------- */
      function applyFilters(){
        const fOffer = (root.querySelector('#f_offer').value || '').trim();
        const fAff   = (root.querySelector('#f_aff').value || '').trim();
        const fSub   = (root.querySelector('#f_sub').value || '').trim();
        const fPri   = root.querySelector('#f_pri').value;
        const fQ     = (root.querySelector('#f_q').value || '').toLowerCase().trim();
        const onlyA  = root.querySelector('#f_active').checked;

        root.querySelectorAll('.rui-group').forEach(group=>{
          // start met zichtbaar
          let visible = true;

          // Offer filter (match op group-key)
          if(fOffer){
            const key = group.dataset.offer || '';
            if(!String(key).includes(fOffer)) visible = false;
          }

          // Als group open is, filter op rijen; tel zichtbare rijen
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

          // werk teller in header bij
          group.querySelector('.rui-group__meta').textContent = `${rowsVisible} regel(s)`;

          // als niets matcht, verberg hele group
          group.style.display = (visible && rowsVisible>0) ? '' : 'none';
        });
      }

      // utils
      function emptyToNull(v){ return v==='' ? null : v; }
      function normalizeSub(v){ return (v==='' || v==='null') ? null : v; }
      function getNew(rootEl, name){ return rootEl.querySelector(`[data-new="${name}"]`)?.value ?? ''; }
      function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    }
  };

  global.RulesUI = RulesUI;
})(window);
