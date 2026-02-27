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

          <div class="newbar" style="border-bottom: 1px solid #e2e8f0; border-top:none;">
            <span style="font-size:11px;font-weight:700;color:#2563eb;text-transform:uppercase;">Nieuwe Regel:</span>
            <input type="text" id="n_off"  class="rules-input" placeholder="Offer ID" style="width:100px;border-color:#93c5fd">
            <input type="text" id="n_desc" class="rules-input" placeholder="Omschrijving" style="flex:1">
            <input type="text" id="n_aff"  class="rules-input" placeholder="Aff ID" style="width:70px">
            <input type="text" id="n_sub"  class="rules-input" placeholder="Sub ID" style="width:70px">
            <button id="rui_add_top" class="rules-btn ok" type="button">Add</button>
          </div>

          <div class="table-wrap">
            <table class="rules">
              <colgroup>
                 <col style="width:40px">  <col style="width:90px">  <col style="width:300px"> <col style="width:80px">  <col style="width:80px">  <col style="width:90px">  <col style="width:90px">  <col style="width:110px">  <col style="width:80px">  <col style="width:70px">  <col style="width:80px">  <col style="width:120px"> </colgroup>
              <thead>
                <tr>
                  <th></th>
                  <th>Offer</th>
                  <th>Omschrijving</th>
                  <th>Aff</th>
                  <th>Sub</th>
                  <th style="color:#2563eb">Doel EPC</th>
                  <th>Acc %</th>
                  <th style="text-align:center">Auto</th>
                  <th>Target</th>
                  <th>Vol</th>
                  <th style="text-align:center">Status</th>
                  <th>Actie</th>
                </tr>
              </thead>
              <tbody id="rui_body"></tbody>
            </table>
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
    tInput.value = localStorage.getItem('rui_token') || DEFAULT_TOKEN;
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
        
        // PUNT 1: Data in topregels (Aggregatie)
        const avgAcc = (items.reduce((sum, i) => sum + (i.percent_accept || 0), 0) / items.length).toFixed(1);
        const avgEPC = (items.reduce((sum, i) => sum + (i.min_cpc || 0), 0) / items.length).toFixed(2);
        const hasAuto = items.some(i => i.auto_pilot);

        const headerTr = document.createElement('tr');
        headerTr.className = `group-row ${isOpen ? 'open' : ''}`;
        headerTr.dataset.key = key;
        headerTr.innerHTML = `
          <td style="text-align:center"><span class="group-expander">▶</span></td>
          <td><b>${key}</b></td>
          <td style="color:#64748b; font-size:11px;">${items.length} regels</td>
          <td></td><td></td>
          <td style="color:#2563eb; font-weight:600;">avg €${avgEPC}</td>
          <td style="font-weight:600;">${avgAcc}%</td>
          <td style="text-align:center">${hasAuto ? '🤖' : ''}</td>
          <td></td><td></td><td></td><td></td>
        `;
        tbody.appendChild(headerTr);

        if(isOpen) {
          // PUNT 3: In-line toevoegen per offer
          const addTr = document.createElement('tr');
          addTr.className = 'rule-row visible';
          addTr.style.background = '#f0f9ff';
          addTr.innerHTML = `
            <td></td>
            <td style="color:#94a3b8; font-size:11px;">Sneltoevoegen:</td>
            <td><input type="text" class="quick-desc" placeholder="Nieuwe sub/omschrijving..." style="background:white"></td>
            <td><input type="text" class="quick-aff" placeholder="Aff ID" style="background:white"></td>
            <td><input type="text" class="quick-sub" placeholder="Sub ID" style="background:white"></td>
            <td colspan="6"></td>
            <td><button class="rules-btn ok quick-add-btn" data-off="${key}">Add</button></td>
          `;
          tbody.appendChild(addTr);

          items.forEach(it => {
            const tr = document.createElement('tr');
            tr.className = 'rule-row visible';
            tr.dataset.id = it.id;
            
            // PUNT 2: Uitlijning Autopilot (Flexbox fix)
            const autoPilotDisplay = `
              <div class="col-autopilot" style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; cursor:pointer; min-height:40px;">
                <div style="display:flex; align-items:center; gap:4px;">
                   ${it.auto_pilot ? '<span class="bot-icon">🤖</span><span class="badge badge-auto">AUTO</span>' : '<span class="badge badge-off">MANUEEL</span>'}
                </div>
                ${it.pilot_log ? `<div style="font-size:9px; color:#64748b; font-style:italic; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100px;">${it.pilot_log}</div>` : ''}
              </div>`;

            tr.innerHTML = `
              <td></td>
              <td><span style="color:#94a3b8;font-size:11px">${esc(it.offer_id)}</span></td>
              <td><input type="text" value="${esc(readDesc(it))}" data-k="description"></td>
              <td><input type="text" value="${esc(it.affiliate_id)}" data-k="affiliate_id"></td>
              <td><input type="text" value="${esc(it.sub_id)}" data-k="sub_id"></td>
              <td><input type="number" step="0.01" value="${it.min_cpc ?? 0}" data-k="min_cpc" style="color:#2563eb; font-weight:700"></td>
              <td><input type="number" value="${Number(it.percent_accept ?? 0)}" data-k="percent_accept"></td>
              <td style="text-align:center;">${autoPilotDisplay}</td>
              <td><input type="number" value="${it.target_margin ?? 15}" data-k="target_margin"></td>
              <td><input type="number" value="${it.min_volume ?? 20}" data-k="min_volume"></td>
              <td style="text-align:center"><span class="badge ${it.active ? 'badge-ok' : 'badge-off'}">${it.active ? 'ACTIEF' : 'UIT'}</span></td>
              <td class="row-actions">
                <button class="rules-btn ok" data-act="save" type="button">Save</button>
                <button class="rules-btn danger" data-act="delete" type="button">Del</button>
                <input type="checkbox" ${it.active ? 'checked' : ''} data-k="active" style="display:none">
              </td>
            `;
            tbody.appendChild(tr);
          });
        }
      });
    }

    // Event Delegation voor Knoppen
    mount.addEventListener('click', async (e) => {
      // Toggle Groep
      const header = e.target.closest('tr.group-row');
      if(header){
        const key = header.dataset.key;
        if(OPEN_GROUPS.has(key)) OPEN_GROUPS.delete(key);
        else OPEN_GROUPS.add(key);
        render(); return;
      }

      // Quick Add per Offer
      if(e.target.classList.contains('quick-add-btn')) {
        const off = e.target.dataset.off;
        const row = e.target.closest('tr');
        const payload = {
          offer_id: off,
          description: row.querySelector('.quick-desc').value,
          affiliate_id: row.querySelector('.quick-aff').value,
          sub_id: row.querySelector('.quick-sub').value,
          percent_accept: 100, active: true, auto_pilot: false, min_cpc: 0
        };
        await addRule(payload);
      }

      // Top Add Bar
      if(e.target.id === 'rui_add_top') {
        const payload = {
          offer_id: $('#n_off').value,
          description: $('#n_desc').value,
          affiliate_id: $('#n_aff').value,
          sub_id: $('#n_sub').value,
          percent_accept: 100, active: true, auto_pilot: false, min_cpc: 0
        };
        await addRule(payload);
      }
      
      // Auto Pilot Toggle
      const autoCol = e.target.closest('.col-autopilot');
      if (autoCol) {
        const tr = autoCol.closest('tr');
        const id = tr.dataset.id;
        const item = CACHE.find(i => i.id == id);
        if(item) {
          const newState = !item.auto_pilot;
          await patchRule(id, { auto_pilot: newState });
          item.auto_pilot = newState;
          render();
        }
      }

      // Save/Delete knoppen
      const btn = e.target.closest('button[data-act]');
      if(btn) {
        const tr = btn.closest('tr');
        const id = tr.dataset.id;
        if(btn.dataset.act === 'save') {
           const data = {};
           tr.querySelectorAll('[data-k]').forEach(i => data[i.dataset.k] = i.type==='number' ? parseFloat(i.value) : i.value);
           await patchRule(id, data);
        }
        if(btn.dataset.act === 'delete' && confirm('Zeker weten?')) {
           await deleteRule(id);
        }
      }
    });

    // API Helpers
    async function addRule(p) {
      if(!p.offer_id) return alert('Offer ID nodig');
      await fetch(API_URL, { method:'POST', headers: headers(), body: JSON.stringify(p)});
      await loadRules();
    }
    async function patchRule(id, d) {
      await fetch(API_URL, { method:'PATCH', headers: headers(), body: JSON.stringify({ keys:[id], data:d })});
    }
    async function deleteRule(id) {
      await fetch(API_URL, { method:'DELETE', headers: headers(), body: JSON.stringify([id])});
      await loadRules();
    }

    async function loadRules() {
      tbody.innerHTML = '<tr><td colspan="12">Laden...</td></tr>';
      const res = await fetch(API_URL, { headers: headers() });
      const data = await res.json();
      CACHE = data.items || [];
      render();
    }
    
    loadRules();
    $('#rui_refresh').addEventListener('click', loadRules);
    $('#rui_search').addEventListener('input', render);
  }

  startApp();
})();
