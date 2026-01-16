// public/rules-ui.js
(function() {
  const API_URL = 'https://optimizationtool.vercel.app/api/rules';
  
  // Functie die de app start
  function initApp() {
    const mount = document.getElementById('rules-ui');
    if (!mount) {
      // Als het element er nog niet is, proberen we het niet te forceren
      // Dit voorkomt de rode error in de console
      return; 
    }

    // --- UI SKELETON (Compactere thead) ---
    mount.innerHTML = `
      <div class="rules-wrap">
        <div class="rules-card">
          <div class="rules-toolbar">
            <span class="rules-label">Admin API • X-Admin-Token</span>
            <input id="rui_token" class="rules-input" type="password" style="width:220px" aria-label="Admin token">
            
            <span class="rules-label" style="margin-left:10px">Zoeken</span>
            <input id="rui_search" class="rules-input" type="text" placeholder="Zoek in omschrijving..." style="width:200px">
            
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;margin-left:10px">
               <input type="checkbox" id="rui_active_only" class="chk"> Alleen actieve
            </label>

            <button id="rui_refresh" class="rules-btn" type="button" style="margin-left:auto">Reload</button>
          </div>

          <div class="table-wrap">
            <table class="rules">
              <thead>
                <tr>
                  <th style="width:280px">Omschrijving</th>
                  <th style="width:90px">Affiliate</th>
                  <th style="width:90px">Sub ID</th>
                  <th style="width:90px">Offer ID</th>
                  <th style="width:70px">Accept %</th>
                  <th style="width:90px;text-align:center">Auto Pilot</th>
                  <th style="width:70px">Target %</th>
                  <th style="width:60px">Min Vol</th>
                  <th style="width:50px;text-align:center">Actief</th>
                  <th style="width:80px">Actie</th>
                </tr>
              </thead>
              <tbody id="rui_body"></tbody>
            </table>
          </div>
          
          <div class="newbar">
            <span style="font-size:12px;font-weight:700;color:#2563eb">NIEUWE REGEL:</span>
            <input type="text" id="n_desc" class="rules-input" placeholder="Omschrijving" style="flex:1">
            <input type="text" id="n_aff"  class="rules-input" placeholder="Affiliate" style="width:80px">
            <input type="text" id="n_sub"  class="rules-input" placeholder="Sub ID" style="width:80px">
            <input type="text" id="n_off"  class="rules-input" placeholder="Offer ID" style="width:80px">
            <button id="rui_add" class="rules-btn ok" type="button">Toevoegen</button>
          </div>
          
          <div id="rui_msg" class="rules-empty" style="display:none"></div>
        </div>
      </div>
    `;

    const $ = (s) => mount.querySelector(s);
    const tbody = $('#rui_body');
    const msgEl = $('#rui_msg');
    let CACHE = [];

    // Init Token
    const tInput = $('#rui_token');
    tInput.value = localStorage.getItem('rui_token') || '';
    tInput.addEventListener('change', () => localStorage.setItem('rui_token', tInput.value.trim()));

    function headers() {
      return { 
        'Content-Type': 'application/json', 
        'X-Admin-Token': tInput.value.trim() 
      };
    }

    // --- RENDERING MET BADGES ---
    function readDesc(it) {
      if (it.description) return it.description;
      if (it.Omschrijving) return it.Omschrijving;
      return '';
    }

    function rowHtml(it) {
      const esc = (s) => (s ?? '').toString().replace(/"/g, '&quot;');
      const desc = readDesc(it);
      
      // Auto Pilot Badge Logic
      const autoPilotBadge = it.auto_pilot 
        ? '<span class="badge badge-auto">🤖 AUTO</span>' 
        : '<span class="badge" style="background:#f1f5f9;color:#94a3b8;font-weight:400">OFF</span>';

      return `
        <tr data-id="${it.id}">
          <td><input type="text" value="${esc(desc)}" data-k="description"></td>
          <td><input type="text" value="${esc(it.affiliate_id)}" data-k="affiliate_id"></td>
          <td><input type="text" value="${esc(it.sub_id)}" data-k="sub_id"></td>
          <td><input type="text" value="${esc(it.offer_id)}" data-k="offer_id"></td>
          <td><input type="number" min="0" max="100" value="${Number(it.percent_accept ?? 0)}" data-k="percent_accept"></td>
          
          <td style="text-align:center;cursor:pointer" title="Klik om te wijzigen">
            <label style="cursor:pointer">
              <input class="chk" type="checkbox" ${it.auto_pilot ? 'checked' : ''} data-k="auto_pilot" style="display:none">
              ${autoPilotBadge}
            </label>
          </td>

          <td><input type="number" step="0.1" value="${it.target_margin ?? 15}" data-k="target_margin"></td>
          <td><input type="number" value="${it.min_volume ?? 20}" data-k="min_volume"></td>
          
          <td style="text-align:center">
            <input class="chk" type="checkbox" ${it.active ? 'checked' : ''} data-k="active">
          </td>
          <td class="row-actions">
            <button class="rules-btn ok" data-act="save" type="button" style="height:26px;padding:0 10px;font-size:11px">SAVE</button>
            <button class="rules-btn danger" data-act="delete" type="button" style="height:26px;padding:0 8px;font-size:11px">DEL</button>
          </td>
        </tr>
      `;
    }

    function render() {
      if(!tbody) return;
      tbody.innerHTML = '';
      msgEl.style.display = 'none';

      const term = $('#rui_search').value.toLowerCase();
      const activeOnly = $('#rui_active_only').checked;

      const filtered = CACHE.filter(it => {
        if (activeOnly && !it.active) return false;
        if (!term) return true;
        const txt = (readDesc(it) + ' ' + (it.offer_id||'') + ' ' + (it.affiliate_id||'')).toLowerCase();
        return txt.includes(term);
      });

      if (!filtered.length) {
        msgEl.textContent = 'Geen regels gevonden.';
        msgEl.style.display = 'block';
        return;
      }

      // Sorteer: Auto Pilot bovenaan, daarna Offer ID
      filtered.sort((a,b) => {
        if (a.auto_pilot !== b.auto_pilot) return b.auto_pilot ? 1 : -1;
        return String(a.offer_id || '').localeCompare(String(b.offer_id || ''));
      });

      filtered.forEach(it => {
        tbody.insertAdjacentHTML('beforeend', rowHtml(it));
      });
    }

    // --- API ACTIONS ---
    async function loadRules() {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px">Laden...</td></tr>';
      try {
        const res = await fetch(API_URL, { headers: headers() });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        CACHE = data.items || [];
        render();
      } catch (e) {
        msgEl.textContent = 'Error laden: ' + e.message;
        msgEl.style.display = 'block';
        tbody.innerHTML = '';
      }
    }

    // Event Listeners
    tbody.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      const chk = e.target.closest('input[type=checkbox][data-k="auto_pilot"]'); 
      
      if (btn) {
        const tr = btn.closest('tr');
        const id = tr.dataset.id;
        const act = btn.dataset.act;

        if (act === 'delete') {
          if (!confirm('Regel verwijderen?')) return;
          await fetch(API_URL, { 
            method: 'DELETE', 
            headers: headers(), 
            body: JSON.stringify([id]) 
          });
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
          
          await fetch(API_URL, {
            method: 'PATCH',
            headers: headers(),
            body: JSON.stringify({ keys: [id], data: payload })
          });
          btn.textContent = 'OK!';
          setTimeout(() => { btn.textContent = 'SAVE'; loadRules(); }, 800);
        }
      }

      if (chk) {
        const tr = chk.closest('tr');
        const id = tr.dataset.id;
        setTimeout(async () => {
           await fetch(API_URL, {
            method: 'PATCH',
            headers: headers(),
            body: JSON.stringify({ keys: [id], data: { auto_pilot: chk.checked } })
          });
          loadRules();
        }, 100);
      }
    });

    $('#rui_add').addEventListener('click', async () => {
      const payload = {
        description: $('#n_desc').value,
        affiliate_id: $('#n_aff').value,
        sub_id: $('#n_sub').value,
        offer_id: $('#n_off').value,
        percent_accept: 100,
        active: true,
        auto_pilot: false
      };
      await fetch(API_URL, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(payload)
      });
      $('#n_desc').value = ''; $('#n_aff').value = ''; $('#n_sub').value = ''; $('#n_off').value = '';
      loadRules();
    });

    $('#rui_refresh').addEventListener('click', loadRules);
    $('#rui_search').addEventListener('input', render);
    $('#rui_active_only').addEventListener('change', render);

    loadRules();
  }

  // --- START LOGICA ---
  // Dit voorkomt "ReferenceError: RulesUI is not defined" in je oude HTML
  window.RulesUI = {
    init: () => {
      // Oude init aanroep negeren we, we gebruiken de automatische start hieronder
      console.log('RulesUI init called (legacy)');
    }
  };

  // Wacht tot de pagina klaar is en start dan pas (voorkomt "Element not found")
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

})();
