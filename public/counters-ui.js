// public/counters-ui.js

(function() {
  const API_BASE     = 'https://optimizationtool.vercel.app/api';
  const API_COUNTERS = `${API_BASE}/counters`;
  const API_RULES    = `${API_BASE}/rules`; 

  let CURRENT_SORT = { key: 'profit', dir: -1 }; 
  let CACHE_DATA = []; 

  function startApp() {
    const mount = document.getElementById('counters-ui');
    if(!mount) return;

    // Verbeterde CSS voor blauwe headers en tabel-uitlijning
    const style = document.createElement('style');
    style.innerHTML = `
      .rules thead th { 
        background-color: #eff6ff !important; 
        color: #1e40af !important; 
        border-bottom: 2px solid #bfdbfe !important;
        padding: 12px 8px !important;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.025em;
      }
      .rules tbody tr:hover { background-color: #f8fafc; }
      .bot-icon { font-size: 14px; margin-right: 6px; filter: grayscale(0); }
      .rules td { vertical-align: middle; }
    `;
    document.head.appendChild(style);

    mount.innerHTML = `
      <div class="rules-wrap">
        <div class="rules-card">
          <div class="rules-toolbar" style="flex-wrap:nowrap; overflow-x:auto;">
            <input id="c_token" class="rules-input" type="password" style="width:120px" placeholder="Token">
            <select id="c_groupmode" class="rules-input" style="width:140px">
              <option value="date">Groep: Datum</option>
              <option value="offer">Groep: Offer</option>
              <option value="affiliate">Groep: Affiliate</option>
            </select>
            <div style="width:1px;height:24px;background:#e2e8f0;margin:0 4px"></div>
            <input id="c_from" class="rules-input" type="date" style="width:130px">
            <input id="c_to"   class="rules-input" type="date" style="width:130px">
            <div style="width:1px;height:24px;background:#e2e8f0;margin:0 4px"></div>
            <input id="c_aff"  class="rules-input" type="text" placeholder="Aff ID" style="width:80px">
            <input id="c_off"  class="rules-input" type="text" placeholder="Off ID" style="width:80px">
            <input id="c_sub"  class="rules-input" type="text" placeholder="Sub ID" style="width:80px">
            <button id="c_run" class="rules-btn" type="button" style="margin-left:auto">Toon</button>
          </div>
          <div class="rules-toolbar" style="border-bottom:1px solid #e2e8f0; background:#f8fafc; gap:8px; padding:6px 16px;">
             <button class="badge badge-auto" data-preset="today" style="border:none;cursor:pointer">Vandaag</button>
             <button class="badge badge-auto" data-preset="yesterday" style="border:none;cursor:pointer">Gisteren</button>
             <button class="badge badge-auto" data-preset="last7" style="border:none;cursor:pointer">7 Dagen</button>
             <button class="badge badge-auto" data-preset="month" style="border:none;cursor:pointer">Deze maand</button>
          </div>
          <div class="table-wrap" style="display:flex; flex-direction:column;">
             <div id="c_groups" style="padding-bottom:20px; flex:1"></div>
          </div>
        </div>
      </div>
    `;

    const mount$ = (s) => mount.querySelector(s);
    const fmt = (n)=> new Intl.NumberFormat('nl-NL').format(n);
    const money = (n)=> new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n);
    const pct = (a,t)=> t>0 ? (100*a/t) : 0;
    const escapeHtml = (s)=> String(s ?? '').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
    
    const tokenInput = mount$('#c_token');
    tokenInput.value = localStorage.getItem('rui_token') || 'ditiseenlanggeheimtoken';

    const selMode = mount$('#c_groupmode');
    selMode.value = localStorage.getItem('c_groupmode') || 'date';
    selMode.addEventListener('change', ()=> {
      localStorage.setItem('c_groupmode', selMode.value);
      renderAll();
    });

    function setPreset(which){
      const d = new Date(); const pad = n=> String(n).padStart(2,'0');
      const toIso = (dt)=> `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
      let from = new Date(d), to = new Date(d);
      if(which==='yesterday'){ from.setDate(d.getDate()-1); to.setDate(d.getDate()-1); }
      if(which==='last7'){ from.setDate(d.getDate()-6); }
      if(which==='month'){ from = new Date(d.getFullYear(), d.getMonth(), 1); }
      mount$('#c_from').value = toIso(from);
      mount$('#c_to').value   = toIso(to);
    }

    let RULES_MAP = null;

    async function ensureRulesAndLogs(){
      try {
        const r = await fetch(API_RULES, { headers: { 'X-Admin-Token': tokenInput.value.trim() } });
        const j = await r.json();
        RULES_MAP = {};

        // Hulpfunctie om ID's te normaliseren (verwijder null/undefined/0/leeg)
        const norm = (val) => {
          const s = String(val || '').trim().toLowerCase();
          return (s === 'null' || s === '0' || s === '') ? '' : s;
        };

        (j.items || []).forEach(it => {
          // We maken een super-match sleutel: offer|aff|sub
          // We zorgen dat 'null' of lege velden altijd consistent worden behandeld
          const key = `${norm(it.offer_id)}|${norm(it.affiliate_id)}|${norm(it.sub_id)}`;
          
          RULES_MAP[key] = { 
            auto_pilot: !!it.auto_pilot, 
            target_margin: Number(it.target_margin || 15), 
            min_cpc: Number(it.min_cpc || 0) 
          };
        });
        console.log("Rules loaded and normalized:", Object.keys(RULES_MAP).length);
      } catch (e) { console.error("Rules mapping error:", e); RULES_MAP = {}; }
    }

    async function fetchData(){
      const host = mount$('#c_groups');
      host.innerHTML = `<div style="padding:20px;text-align:center;color:#64748b">Data ophalen…</div>`;
      try {
        await ensureRulesAndLogs(); 
        const q = new URLSearchParams({ 
          date_from: mount$('#c_from').value, 
          date_to: mount$('#c_to').value,
          affiliate_id: mount$('#c_aff').value,
          offer_id: mount$('#c_off').value,
          sub_id: mount$('#c_sub').value
        });

        const r = await fetch(`${API_COUNTERS}?${q.toString()}`, { headers: { 'X-Admin-Token': tokenInput.value.trim() } });
        const j = await r.json();
        CACHE_DATA = j.items || [];
        renderAll();
      } catch (e) { host.innerHTML = `<div style="padding:20px;color:red">Error: ${e.message}</div>`; }
    }

    function renderAll() {
      const host = mount$('#c_groups');
      if (!CACHE_DATA.length) { host.innerHTML = `<div style="padding:20px;text-align:center">Geen resultaten</div>`; return; }

      const mode = mount$('#c_groupmode').value;
      const grouped = {};
      CACHE_DATA.forEach(it => {
        const key = mode === 'date' ? it.date : (it[mode + '_id'] || '—');
        (grouped[key] ||= []).push(it);
      });

      host.innerHTML = '';
      Object.keys(grouped).sort((a,b)=> (mode==='date' ? b.localeCompare(a) : a.localeCompare(b))).forEach(k => {
        host.appendChild(renderGroup(mode, k, grouped[k]));
      });
      host.appendChild(renderGrandTotal(CACHE_DATA));
    }

    function aggregateRows(items){
      const map = new Map();
      for(const it of items){
        const key = `${it.affiliate_id}|${it.offer_id}|${it.sub_id}`;
        const acc = map.get(key) || { 
          affiliate_id: it.affiliate_id, offer_id: it.offer_id, sub_id: it.sub_id,
          total: 0, accepted: 0, actual_margin: it.actual_margin, revenue: 0, cost: 0, profit: 0, visits: 0
        };
        acc.total += Number(it.total_leads || 0);
        acc.accepted += Number(it.accepted_leads || 0);
        acc.revenue += Number(it.revenue || 0);
        acc.cost    += Number(it.cost || 0);
        acc.profit  += Number(it.profit || 0);
        acc.visits  += Number(it.visits || 0);
        map.set(key, acc);
      }
      return [...map.values()];
    }

    function renderGroup(mode, key, items){
      let rows = aggregateRows(items);
      
      rows.sort((a, b) => {
        let valA = a[CURRENT_SORT.key];
        let valB = b[CURRENT_SORT.key];
        if (typeof valA === 'string') return valA.localeCompare(valB) * CURRENT_SORT.dir;
        return (valA - valB) * CURRENT_SORT.dir;
      });

      let t_tot=0, t_acc=0, t_rev=0, t_prof=0, t_visits=0, t_cost=0;
      rows.forEach(r => { t_tot += r.total; t_acc += r.accepted; t_rev += r.revenue; t_prof += r.profit; t_visits += r.visits; t_cost += r.cost; });

      const el = document.createElement('div');
      el.className = 'group'; 
      
      el.innerHTML = `
        <div class="group-header" data-role="toggle" style="cursor:pointer">
          <span class="chev" style="transform:rotate(90deg)">▶</span>
          <span><b>${key}</b></span>
          <div style="margin-left:auto; display:flex; gap:15px; font-size:12px; font-weight:400; color:#64748b; align-items:center">
             <span>Rev: <b>${money(t_rev)}</b></span>
             <span>Profit: <b style="color:${t_prof >= 0 ? '#16a34a':'#dc2626'}">${money(t_prof)}</b></span>
             <span style="border-left:1px solid #cbd5e1; padding-left:15px">Total: <b>${fmt(t_tot)}</b> • Acc: <b>${fmt(t_acc)}</b> (${pct(t_acc,t_tot).toFixed(1)}%)</span>
          </div>
        </div>
        <div class="group-body">
          <table class="rules">
            <thead>
              <tr>
                <th style="cursor:pointer" data-sort="offer_id">OFFER ↕</th>
                <th style="cursor:pointer" data-sort="affiliate_id">AFF ↕</th>
                <th style="cursor:pointer" data-sort="sub_id">SUB ↕</th>
                <th style="cursor:pointer" data-sort="total">TOTAL ↕</th>
                <th style="cursor:pointer" data-sort="accepted">ACC ↕</th>
                <th style="cursor:pointer" data-sort="revenue">OMZET ↕</th>
                <th style="cursor:pointer" data-sort="cost">KOSTEN ↕</th>
                <th style="cursor:pointer" data-sort="profit">WINST ↕</th>
                <th style="cursor:pointer" data-sort="accepted">ACC % ↕</th>
                <th>TARGET MARGE</th>
                <th style="cursor:pointer" data-sort="actual_margin">MARGE % ↕</th> 
                <th>DOEL EPC</th>
                <th style="cursor:pointer" data-sort="visits">EPC ↕</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => {
              const norm = (val) => {
              const s = String(val || '').trim().toLowerCase();
              return (s === 'null' || s === '0' || s === '') ? '' : s;
              };

                const ruleKey = `${norm(r.offer_id)}|${norm(r.affiliate_id)}|${norm(r.sub_id)}`;
                const rule = RULES_MAP?.[ruleKey] || {};
                
                const epc = r.visits > 0 ? (r.cost / r.visits) : 0;
                const targetMarge = rule.target_margin || 15;
                const isDanger = (r.actual_margin !== null && r.actual_margin < targetMarge);
                const showBot = rule.auto_pilot ? '<span class="bot-icon" title="Auto Pilot Actief">🤖</span>' : '';
                
                return `
                  <tr>
                    <td>${escapeHtml(r.offer_id)}</td>
                    <td>${escapeHtml(r.affiliate_id)}</td>
                    <td>${escapeHtml(r.sub_id)}</td>
                    <td>${fmt(r.total)}</td>
                    <td>${fmt(r.accepted)}</td>
                    <td>${money(r.revenue)}</td>
                    <td style="color:#64748b">${money(r.cost)}</td>
                    <td style="font-weight:700; color:${r.profit >= 0 ? '#16a34a' : '#dc2626'}">${money(r.profit)}</td>
                    <td style="font-weight:600; display:flex; align-items:center; border:none; height:40px;">${showBot}${pct(r.accepted,r.total).toFixed(1)}%</td>
                    <td style="font-weight:600;color:#2563eb">${targetMarge}%</td>
                    <td><span class="badge ${isDanger ? 'badge-danger' : 'badge-ok'}">${r.actual_margin ? r.actual_margin.toFixed(1)+'%' : '—'}</span></td>
                    <td style="color:#1e40af; font-weight:600;">${rule.min_cpc > 0 ? money(rule.min_cpc) : '-'}</td>
                    <td style="font-weight:600">${money(epc)}</td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;

      el.querySelector('[data-role=toggle]').addEventListener('click', () => {
        const body = el.querySelector('.group-body');
        const chev = el.querySelector('.chev');
        const isCollapsed = body.style.display === 'none';
        body.style.display = isCollapsed ? 'block' : 'none';
        chev.style.transform = isCollapsed ? 'rotate(90deg)' : 'rotate(0deg)';
      });
      return el;
    }

    function renderGrandTotal(allRows){
      let total = 0, accepted = 0, rev = 0, prof = 0;
      allRows.forEach(it => { total += it.total_leads; accepted += it.accepted_leads; rev += (it.revenue || 0); prof += (it.profit || 0); });
      const wrap = document.createElement('div');
      wrap.className = 'total-summary';
      wrap.innerHTML = `<span>TOTAAL SELECTIE</span><div style="display:flex; gap:20px"><span>Omzet: ${money(rev)}</span><span>Winst: ${money(prof)}</span><span>Leads: ${fmt(total)} • Acc: ${fmt(accepted)} (${pct(accepted,total).toFixed(1)}%)</span></div>`;
      return wrap;
    }

    mount.addEventListener('click', e => {
      const btn = e.target.closest('[data-preset]');
      if(btn) { setPreset(btn.dataset.preset); fetchData(); }
      
      const th = e.target.closest('th[data-sort]');
      if (th) {
        const key = th.dataset.sort;
        CURRENT_SORT.dir = (CURRENT_SORT.key === key) ? CURRENT_SORT.dir * -1 : -1;
        CURRENT_SORT.key = key;
        renderAll(); 
      }
    });

    setPreset('last7');
    mount$('#c_run').addEventListener('click', fetchData);
    fetchData(); 
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startApp);
  else startApp();
})();
