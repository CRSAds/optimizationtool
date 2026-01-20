(function() {
  const API_URL = 'https://optimizationtool.vercel.app/api/rules';
  const DEFAULT_TOKEN = "ditiseenlanggeheimtoken";

  function startApp() {
    const mount = document.getElementById('rules-ui');
    if (!mount) return;

    if (mount.getAttribute('data-loaded') === 'true') return;
    mount.setAttribute('data-loaded', 'true');

    mount.innerHTML = `
      <div class="rules-wrap">
        <div class="rules-card">
          <div class="rules-toolbar">
            <span class="rules-label">Rules API</span>
            <input id="rui_token" class="rules-input" type="password" style="width:140px" placeholder="Token">
            <div style="width:1px;height:24px;background:#e2e8f0;margin:0 8px"></div>
            <span class="rules-label">Zoeken</span>
            <input id="rui_search" class="rules-input" type="text" placeholder="Offer, Aff, Desc..." style="width:180px">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;margin-left:10px">
               <input type="checkbox" id="rui_active_only" class="chk"> Actief
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;margin-left:10px">
               <input type="checkbox" id="rui_autopilot_only" class="chk"> Auto Pilot
            </label>
            <button id="rui_refresh" class="rules-btn ghost" type="button" style="margin-left:auto">⟳</button>
          </div>

          <div class="table-wrap">
            <table class="rules">
              <colgroup>
                 <col style="width:30px">
                 <col style="width:60px">
                 <col style="width:auto">
                 <col style="width:50px">
                 <col style="width:50px">
                 
                 <col style="width:70px"> <col style="width:60px"> <col style="width:80px"> <col style="width:60px"> <col style="width:50px"> <col style="width:40px"> <col style="width:90px"> </colgroup>
              <thead>
                <tr>
                  <th></th>
                  <th>Offer</th>
                  <th>Omschrijving</th>
                  <th>Aff</th>
                  <th>Sub</th>
                  
                  <th style="color:#2563eb">Doel EPC</th> <th>Acc %</th>
                  <th style="text-align:center">Auto</th>
                  <th>Target</th>
                  <th>Vol</th>
                  <th style="text-align:center">Aan</th>
                  <th>Actie</th>
                </tr>
              </thead>
              <tbody id="rui_body"></tbody>
            </table>
          </div>
          
          <div class="newbar">
            <span style="font-size:11px;font-weight:700;color:#2563eb;text-transform:uppercase;">NIEUW:</span>
            <input type="text" id="n_off"  class="rules-input" placeholder="Offer ID" style="width:100px;border-color:#93c5fd">
            <input type="text" id="n_desc" class="rules-input" placeholder="Omschrijving" style="flex:1">
            <input type="text" id="n_aff"  class="rules-input" placeholder="Aff ID" style="width:50px">
            <input type="text" id="n_sub"  class="rules-input" placeholder="Sub ID" style="width:50px">
            <button id="rui_add" class="rules-btn ok" type="button">Add</button>
          </div>
          <div id="rui_msg" class="rules-empty" style="display:none"></div>
        </div>
      </div>
    `;

    const $ = (s) => mount.querySelector(s);
    const tbody = $('#rui_body');
    const msgEl = $('#rui_msg');
    let CACHE = [];
    let OPEN_GROUPS = new Set(); 

    const tInput = $('#rui_token');
    let currentToken = localStorage.getItem('rui_token');
    
    if (!currentToken || currentToken.trim() === '') {
       currentToken = DEFAULT_TOKEN;
       localStorage.setItem('rui_token', currentToken);
    }
    tInput.value = currentToken;
    tInput.addEventListener('change', () => localStorage.setItem('rui_token', tInput.value.trim()));

    function headers() { return { 'Content-Type': 'application/json', 'X-Admin-Token': tInput.value.trim() }; }
    function esc(s) { return (s ?? '').toString().replace(/"/g, '&quot;'); }
    function readDesc(it) { return it.description || it.Omschrijving || ''; }

    function render() {
      if(!tbody) return;
      tbody.innerHTML = '';
      msgEl.style.display = 'none';

      const term = $('#rui_search').value.toLowerCase();
      const activeOnly = $('#rui_active_only').checked;
      const autoPilotOnly = $('#rui_autopilot_only').checked;

      let filtered = CACHE.filter(it => {
        if (activeOnly && !it.active) return false;
        if (autoPilotOnly && !it.auto_pilot) return false;
        if (!term) return true;
        const txt = [it.offer_id, readDesc(it), it.affiliate_id, it.sub_id].join(' ').toLowerCase();
        return txt.includes(term);
      });

      if (!filtered.length) {
        msgEl.innerHTML = 'Geen regels gevonden.<br><small style="color:#94a3b8">Check of je token klopt.</small>';
        msgEl.style.display = 'block';
        return;
      }

      const groups = {};
      filtered.forEach(it => {
        const oid = it.offer_id || 'Overig';
        if(!groups[oid]) groups[oid] = [];
        groups[oid].push(it);
      });

      const keys = Object.keys(groups).sort((a,b) => (a==='Overig'?1:b==='Overig'?-1:Number(a)-Number(b)));

      keys.forEach(key => {
        const items = groups[key];
        const isOpen = OPEN_GROUPS.has(key) || term.length > 0;
        
        const headerTr = document.createElement('tr');
        headerTr.className = `group-row ${isOpen ? 'open' : ''}`;
        headerTr.dataset.key = key;
        headerTr.innerHTML = `
          <td style="text-align:center"><span class="group-expander">▶</span></td>
          <td colspan="11">
            Offer: <span style="color:#2563eb">${key}</span> 
            <span style="font-weight:400;color:#64748b;font-size:12px;margin-left:8px">(${items.length} regels)</span>
          </td>
        `;
        tbody.appendChild(headerTr);

        items.forEach(it => {
          const tr = document.createElement('tr');
          tr.className = `rule-row ${isOpen ? 'visible' : ''}`;
          tr.dataset.id = it.id;
          
          const autoBadge = it.auto_pilot 
            ? `<span class="badge badge-auto">AAN</span>` 
            : `<span class="badge badge-off">UIT</span>`;
          
          // HERSTELD: Log zichtbaar maken
          const pilotLog = it.pilot_log 
            ? `<div style="font-size:10px; color:#dc2626; margin-top:4px; white-space:nowrap">${it.pilot_log}</div>` 
            : '';

          tr.innerHTML = `
            <td></td>
            <td><span style="color:#94a3b8;font-size:11px">${esc(it.offer_id)}</span></td>
            <td><input type="text" value="${esc(readDesc(it))}" data-k="description"></td>
            <td><input type="text" value="${esc(it.affiliate_id)}" data-k="affiliate_id"></td>
            <td><input type="text" value="${esc(it.sub_id)}" data-k="sub_id"></td>
            
            <td><input type="number" step="0.01" value="${it.min_cpc ?? 0}" data-k="min_cpc" style="color:#2563eb; font-weight:600"></td>

            <td><input type="number" min="0" max="100" value="${Number(it.percent_accept ?? 0)}" data-k="percent_accept"></td>
            
            <td style="text-align:center;" class="col-autopilot">
               ${autoBadge}
               ${pilotLog}
            </td>

            <td><input type="number" step="0.1" value="${it.target_margin ?? 15}" data-k="target_margin"></td>
            <td><input type="number" value="${it.min_volume ?? 20}" data-k="min_volume"></td>
            
            <td style="text-align:center">
              <input class="chk" type="checkbox" ${it.active ? 'checked' : ''} data-k="active">
            </td>
            <td class="row-actions">
              <button class="rules-btn ok" data-act="save" type="button">Save</button>
              <button class="rules-btn danger" data-act="delete" type="button">Del</button>
            </td>
          `;
          tbody.appendChild(tr);
        });
      });
    }

    tbody.addEventListener('click', (e) => {
      const header = e.target.closest('tr.group-row');
      if(header){
        const key = header.dataset.key;
        if(OPEN_GROUPS.has(key)) OPEN_GROUPS.delete(key);
        else OPEN_GROUPS.add(key);
        render(); return;
      }
    });

    tbody.addEventListener('click', async (e) => {
      const autoCol = e.target.closest('.col-autopilot');
      if (autoCol) {
        e.stopPropagation();
        const tr = autoCol.closest('tr');
        const id = tr.dataset.id;
        const item = CACHE.find(i => i.id == id);
        if(!item) return;

        const newState = !item.auto_pilot;
        item.auto_pilot = newState;
        autoCol.innerHTML = newState ? `<span class="badge badge-auto">AAN</span>` : `<span class="badge badge-off">UIT</span>`;

        try {
          await fetch(API_URL, {
            method: 'PATCH',
            headers: headers(),
            body: JSON.stringify({ keys: [id], data: { auto_pilot: newState } })
          });
        } catch(err) {
          alert('Fout: ' + err);
          item.auto_pilot = !newState; render();
        }
        return;
      }

      const btn = e.target.closest('button');
      if (!btn) return;
      const tr = btn.closest('tr');
      const id = tr.dataset.id;
      const act = btn.dataset.act;

      if (act === 'delete') {
        if (!confirm('Verwijderen?')) return;
        await fetch(API_URL, { method: 'DELETE', headers: headers(), body: JSON.stringify([id]) });
        await loadRules();
      }

      if (act === 'save') {
        const payload = {};
        tr.querySelectorAll('[data-k]').forEach(el => {
          const k = el.dataset.k;
          if (el.type === 'checkbox') payload[k] = el.checked;
          else if (el.type === 'number') payload[k] = parseFloat(el.value);
          else payload[k] = el.value;
        });
        
        btn.textContent = '...';
        await fetch(API_URL, {
          method: 'PATCH',
          headers: headers(),
          body: JSON.stringify({ keys: [id], data: payload })
        });
        
        const item = CACHE.find(i => i.id == id);
        Object.assign(item, payload);
        btn.textContent = 'Save';
      }
    });

    $('#rui_add').addEventListener('click', async () => {
      const off = $('#n_off').value.trim();
      if(!off) { alert('Offer ID is verplicht'); return; }

      const payload = {
        offer_id: off,
        description: $('#n_desc').value,
        affiliate_id: $('#n_aff').value,
        sub_id: $('#n_sub').value,
        percent_accept: 100,
        active: true,
        auto_pilot: false,
        min_cpc: 0 // NIEUW: Default waarde
      };
      
      const btn = $('#rui_add');
      btn.textContent = '...';
      try {
        await fetch(API_URL, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(payload)
        });
        $('#n_desc').value = ''; $('#n_aff').value = ''; $('#n_sub').value = ''; $('#n_off').value = '';
        await loadRules();
      } catch(e) { alert('Error: ' + e); }
      btn.textContent = 'Add';
    });

    $('#rui_refresh').addEventListener('click', loadRules);
    $('#rui_search').addEventListener('input', render);
    $('#rui_active_only').addEventListener('change', render);
    $('#rui_autopilot_only').addEventListener('change', render);

    async function loadRules() {
      tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:20px;color:#94a3b8">Laden...</td></tr>';
      try {
        const res = await fetch(API_URL, { headers: headers() });
        const data = await res.json();
        if (!data.items) throw new Error(data.error || 'Geen data');
        CACHE = data.items || [];
        render();
      } catch (e) {
        msgEl.innerHTML = `Fout bij laden: ${e.message}`;
        msgEl.style.display = 'block';
      }
    }
    
    loadRules();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startApp);
  else startApp();
})();
