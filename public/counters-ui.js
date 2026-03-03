(function() {
  const API_BASE     = 'https://optimizationtool.vercel.app/api';
  const API_COUNTERS = `${API_BASE}/counters`;
  const API_RULES    = `${API_BASE}/rules`; 
  const API_LOGS     = `${API_BASE}/pilot-logs`;

  let CURRENT_SORT = { key: 'profit', dir: -1 }; 
  let CACHE_DATA = []; 
  let RULES_MAP = {};
  let OPEN_GROUPS = new Set(); 

  function startApp() {
    const mount = document.getElementById('counters-ui');
    if(!mount) return;

    mount.innerHTML = `
      <div class="rules-wrap">
        <div id="pilot-logs-container" class="pilot-log-card" style="display:none;">
           <div class="pilot-log-header">
              <span style="font-size:11px; font-weight:800; color:#1e40af; text-transform:uppercase;">🚀 Pilot Ingrepen</span>
           </div>
           <div id="pilot-logs-list"></div>
        </div>

        <div class="rules-card">
          <div class="rules-toolbar">
            <input id="c_token" class="rules-input" type="password" style="width:100px" placeholder="Token">
            <select id="c_groupmode" class="rules-input" style="width:120px">
              <option value="date">Groep: Datum</option>
              <option value="offer">Groep: Offer</option>
            </select>
            <input id="c_from" class="rules-input" type="date" style="width:130px">
            <input id="c_to"   class="rules-input" type="date" style="width:130px">
            <button id="c_run" class="rules-btn" style="margin-left:auto">Toon</button>
          </div>
          <div class="table-wrap">
            <div id="c_groups"></div>
          </div>
        </div>
      </div>
    `;

    const mount$ = (s) => mount.querySelector(s);
    const money = (n)=> new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n);
    const fmt = (n)=> new Intl.NumberFormat('nl-NL').format(n);
    const pct = (a,t)=> t>0 ? (100*a/t) : 0;
    const norm = (val) => String(val || '').trim().toLowerCase();

    const tokenInput = mount$('#c_token');
    tokenInput.value = localStorage.getItem('rui_token') || 'ditiseenlanggeheimtoken';

    async function fetchLogs() {
      const list = mount$('#pilot-logs-list');
      const container = mount$('#pilot-logs-container');
      try {
        const r = await fetch(API_LOGS, { headers: { 'X-Admin-Token': tokenInput.value.trim() } });
        const j = await r.json();
        const logs = j.items || [];
        if (logs.length === 0) { container.style.display = 'none'; return; }
        container.style.display = 'block';

        const counts = {};
        const logsWithCount = [...logs].reverse().map(log => {
          const key = `${log.offer_id}|${log.sub_id}`;
          counts[key] = (counts[key] || 0) + 1;
          return { ...log, adjustment_nr: counts[key] };
        }).reverse();

        list.innerHTML = `
          <table class="rules" style="font-size:11px;">
            <thead>
              <tr style="background:#f8fafc">
                <th style="width:100px">Datum</th>
                <th style="width:150px">IDs</th>
                <th style="width:80px">Actie</th>
                <th>Reden</th>
                <th style="width:40px">#</th>
              </tr>
            </thead>
            <tbody>
              ${logsWithCount.slice(0, 5).map(l => `
                <tr>
                  <td>${new Date(l.created_at).toLocaleString('nl-NL', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'})}</td>
                  <td><b>${l.offer_id}</b> | ${l.sub_id || '-'}</td>
                  <td><span class="badge badge-auto">ACC: ${l.new_accept}%</span></td>
                  <td style="color:#64748b; font-size:10px;">${l.reason}</td>
                  <td><small>${l.adjustment_nr}e</small></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      } catch (e) { console.error(e); }
    }

    function renderAll() {
      const host = mount$('#c_groups');
      host.innerHTML = '';
      const mode = mount$('#c_groupmode').value;
      const grouped = {};
      
      CACHE_DATA.forEach(it => {
        const key = mode === 'date' ? it.date : it.offer_id;
        (grouped[key] ||= []).push(it);
      });

      Object.keys(grouped).sort().reverse().forEach(key => {
        const items = grouped[key];
        let t_rev=0, t_prof=0, t_tot=0, t_acc=0;
        items.forEach(i => { t_rev += i.revenue; t_prof += i.profit; t_tot += i.total_leads; t_acc += i.accepted_leads; });

        const groupEl = document.createElement('div');
        const isOpen = OPEN_GROUPS.has(key);
        groupEl.className = `group ${isOpen ? '' : 'collapsed'}`;
        
        groupEl.innerHTML = `
          <div class="group-header" data-key="${key}">
            <span class="chev">▼</span>
            <span style="flex:1"><b>${key}</b></span>
            <div style="display:flex; gap:15px; font-size:11px;">
              <span>Rev: <b>${money(t_rev)}</b></span>
              <span style="color:${t_prof >= 0 ? '#16a34a' : '#dc2626'}">Prof: <b>${money(t_prof)}</b></span>
              <span>Acc: <b>${pct(t_acc, t_tot).toFixed(1)}%</b></span>
            </div>
          </div>
          <div class="group-body">
            <table class="rules">
              <thead>
                <tr>
                  <th>Offer</th><th>Sub</th><th>Total</th><th>Acc</th><th>Rev</th><th>Profit</th><th>Acc%</th><th>Target</th><th>Marge</th><th>EPC</th>
                </tr>
              </thead>
              <tbody>
                ${items.map(r => {
                  const rule = RULES_MAP[`${norm(r.offer_id)}||${norm(r.sub_id)}`] || RULES_MAP[norm(r.offer_id)] || {};
                  const isDanger = (r.actual_margin < (rule.target_margin || 15));
                  return `
                    <tr>
                      <td>${r.offer_id}</td><td>${r.sub_id || '-'}</td>
                      <td>${fmt(r.total_leads)}</td><td>${fmt(r.accepted_leads)}</td>
                      <td>${money(r.revenue)}</td><td style="font-weight:700; color:${r.profit>=0?'#16a34a':'#dc2626'}">${money(r.profit)}</td>
                      <td>${rule.auto_pilot?'🤖':''}${pct(r.accepted_leads, r.total_leads).toFixed(1)}%</td>
                      <td>${rule.target_margin || 15}%</td>
                      <td><span class="badge ${isDanger?'badge-danger':'badge-ok'}">${r.actual_margin.toFixed(1)}%</span></td>
                      <td>${money(r.visits > 0 ? r.cost/r.visits : 0)}</td>
                    </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        `;

        groupEl.querySelector('.group-header').onclick = () => {
          if (OPEN_GROUPS.has(key)) OPEN_GROUPS.delete(key);
          else OPEN_GROUPS.add(key);
          groupEl.classList.toggle('collapsed');
        };

        host.appendChild(groupEl);
      });
    }

    async function fetchData() {
      await ensureRules();
      await fetchLogs();
      const q = new URLSearchParams({ 
          date_from: mount$('#c_from').value, 
          date_to: mount$('#c_to').value 
      });
      const r = await fetch(`${API_COUNTERS}?${q.toString()}`, { headers: { 'X-Admin-Token': tokenInput.value.trim() } });
      const j = await r.json();
      CACHE_DATA = j.items || [];
      renderAll();
    }

    async function ensureRules() {
      const r = await fetch(API_RULES, { headers: { 'X-Admin-Token': tokenInput.value.trim() } });
      const j = await r.json();
      (j.items || []).forEach(it => {
        const off = norm(it.offer_id), sub = norm(it.sub_id);
        RULES_MAP[sub ? `${off}||${sub}` : off] = it;
      });
    }

    const d = new Date();
    mount$('#c_from').value = d.toISOString().split('T')[0];
    mount$('#c_to').value = d.toISOString().split('T')[0];
    mount$('#c_run').onclick = fetchData;
    fetchData();
  }

  startApp();
})();
