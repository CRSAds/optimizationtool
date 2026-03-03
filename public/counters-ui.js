// public/counters-ui.js

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

    // De HTML structuur met een aparte container voor de logs boven de hoofdkaart
    mount.innerHTML = `
      <div class="rules-wrap">
        <div id="pilot-logs-container" class="pilot-log-card" style="display:none;">
           <div class="pilot-log-header">
              <span style="font-size:12px; font-weight:800; color:#1e40af; text-transform:uppercase;">🚀 Recente Pilot Ingrepen</span>
              <span style="font-size:11px; color:#64748b;">Laatste 50 acties</span>
           </div>
           <div id="pilot-logs-list" style="max-height:300px; overflow-y:auto;"></div>
        </div>

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
          <div class="table-wrap">
            <div id="c_groups" style="padding-bottom:20px;"></div>
          </div>
        </div>
      </div>
    `;

    const mount$ = (s) => mount.querySelector(s);
    const fmt = (n)=> new Intl.NumberFormat('nl-NL').format(n);
    const money = (n)=> new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n);
    const pct = (a,t)=> t>0 ? (100*a/t) : 0;
    const escapeHtml = (s)=> String(s ?? '').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
    const norm = (val) => String(val || '').trim().toLowerCase();

    const tokenInput = mount$('#c_token');
    tokenInput.value = localStorage.getItem('rui_token') || 'ditiseenlanggeheimtoken';

    const selMode = mount$('#c_groupmode');
    selMode.value = localStorage.getItem('c_groupmode') || 'date';
    selMode.addEventListener('change', ()=> {
      localStorage.setItem('c_groupmode', selMode.value);
      OPEN_GROUPS.clear(); 
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

    async function ensureRules(){
      try {
        const r = await fetch(API_RULES, { headers: { 'X-Admin-Token': tokenInput.value.trim() } });
        const j = await r.json();
        RULES_MAP = {};
        (j.items || []).forEach(it => {
          const off = norm(it.offer_id), aff = norm(it.affiliate_id), sub = norm(it.sub_id);
          const data = { auto_pilot: !!it.auto_pilot, target_margin: Number(it.target_margin || 15), min_cpc: Number(it.min_cpc || 0) };
          if (off && aff && sub) RULES_MAP[`${off}|${aff}|${sub}`] = data;
          if (off && sub)        RULES_MAP[`${off}||${sub}`] = data;
          if (off && aff)        RULES_MAP[`${off}|${aff}|`] = data;
          if (off)               RULES_MAP[off] = data;
        });
      } catch (e) { console.error(e); RULES_MAP = {}; }
    }

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
        const reversed = [...logs].reverse();
        const logsWithCount = reversed.map(log => {
          const key = `${log.offer_id}|${log.affiliate_id}|${log.sub_id}`;
          counts[key] = (counts[key] || 0) + 1;
          return { ...log, adjustment_nr: counts[key] };
        }).reverse();

        list.innerHTML = `
          <table style="width:100%; border-collapse:collapse; font-size:12px;">
            <thead style="background:#f8fafc; position:sticky; top:0; z-index:5;">
              <tr style="text-align:left; color:#64748b; border-bottom:1px solid #e2e8f0;">
                <th style="padding:10px 16px">Datum</th>
                <th style="padding:10px 16px">IDs</th>
                <th style="padding:10px 16px">Aanpassing</th>
                <th style="padding:10px 16px">Reden</th>
                <th style="padding:10px 16px; text-align:center;">#</th>
              </tr>
            </thead>
            <tbody>
              ${logsWithCount.map(l => `
                <tr style="border-bottom:1px solid #f1f5f9;">
                  <td style="padding:10px 16px; white-space:nowrap; color:#1e293b;">${new Date(l.created_at).toLocaleString('nl-NL', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'})}</td>
                  <td style="padding:10px 16px"><b>${l.offer_id}</b> <span style="color:#94a3b8">|</span> ${l.affiliate_id || '-'} <span style="color:#94a3b8">|</span> ${l.sub_id || '-'}</td>
                  <td style="padding:10px 16px"><span class="badge badge-auto" style="font-size:11px;">ACC: ${l.new_accept}%</span></td>
                  <td style="padding:10px 16px; color:#475569;">${l.reason}</td>
                  <td style="padding:10px 16px; text-align:center;"><span style="background:#f1f5f9; border:1px solid #e2e8f0; padding:2px 8px; border-radius:12px; font-weight:700; font-size:10px;">${l.adjustment_nr}e</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      } catch (e) { console.error("Logs error:", e); }
    }

    async function fetchData(){
      const host = mount$('#c_groups');
      host.innerHTML = `<div style="padding:20px;text-align:center;color:#64748b">Laden…</div>`;
      try {
        await ensureRules(); 
        await fetchLogs();
        const q = new URLSearchParams({ 
          date_from: mount$('#c_from').value, date_to: mount$('#c_to').value,
          affiliate_id: mount$('#c_aff').value, offer_id: mount$('#c_off').value, sub_id: mount$('#c_sub').value
        });
        const r = await fetch(`${API_COUNTERS}?${q.toString()}`, { headers: { 'X-Admin-Token': tokenInput.value.trim() } });
        const j = await r.json();
        CACHE_DATA = j.items || [];
        OPEN_GROUPS.clear(); 
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
        const acc = map.get(key) || { affiliate_id: it.affiliate_id, offer_id: it.offer_id, sub_id: it.sub_id, total: 0, accepted: 0, actual_margin: it.actual_margin, revenue: 0, cost: 0, profit: 0, visits: 0 };
        acc.total += Number(it.total_leads || 0); acc.accepted += Number(it.accepted_leads || 0); acc.revenue += Number(it.revenue || 0); acc.cost += Number(it.cost || 0); acc.profit += Number(it.profit || 0); acc.visits += Number(it.visits || 0);
        map.set(key, acc);
      }
      return [...map.values()];
    }

    function renderGroup(mode, key, items){
      let rows = aggregateRows(items);
      rows.sort((a, b) => {
        let valA = a[CURRENT_SORT.key], valB = b[CURRENT_SORT.key];
        if (typeof valA === 'string') return valA.localeCompare(valB) * CURRENT_SORT.dir;
        return (valA - valB) * CURRENT_SORT.dir;
      });

      let t_tot=0, t_acc=0, t_rev=0, t_prof=0, t_cost=0;
      rows.forEach(r => { t_tot += r.total; t_acc += r.accepted; t_rev += r.revenue; t_prof += r.profit; t_cost += r.cost; });

      const el = document.createElement('div');
      const isOpen = OPEN_GROUPS.has(key);
      el.className = `group ${isOpen ? '' : 'collapsed'}`; 
      
      // GECORRIGEERDE HOOFDRIJ: Strakke uitlijning en duidelijkere KPI's
      el.innerHTML = `
        <div class="group-header" data-role="toggle" style="cursor:pointer; display:flex; align-items:center; padding:12px 16px; background:#f1f5f9; border-bottom:1px solid #cbd5e1;" data-key="${key}">
          <span class="chev" style="transform:${isOpen ? 'rotate(90deg)' : 'rotate(0deg)'}; margin-right:10px; font-weight:bold; color:#2563eb;">▶</span>
          <span style="font-size:14px; font-weight:800; color:#1e293b;">${key}</span>
          <div style="margin-left:auto; display:flex; gap:20px; font-size:12px; align-items:center">
             <span>Rev: <b style="color:#1e293b">${money(t_rev)}</b></span>
             <span>Profit: <b style="color:${t_prof >= 0 ? '#16a34a':'#dc2626'}">${money(t_prof)}</b></span>
             <span style="border-left:1px solid #cbd5e1; padding-left:20px; color:#64748b;">Leads: <b style="color:#1e293b">${fmt(t_tot)}</b> • Acc: <b style="color:#1e293b">${pct(t_acc,t_tot).toFixed(1)}%</b></span>
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
                <th>TARGET</th>
                <th style="cursor:pointer" data-sort="actual_margin">MARGE % ↕</th> 
                <th>DOEL EPC</th>
                <th style="cursor:pointer" data-sort="visits">EPC ↕</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => {
                const off = norm(r.offer_id), aff = norm(r.affiliate_id), sub = norm(r.sub_id);
                const rule = RULES_MAP[`${off}|${aff}|${sub}`] || RULES_MAP[`${off}||${sub}`] || RULES_MAP[`${off}|${aff}|`] || RULES_MAP[off] || {};
                const epc = r.visits > 0 ? (r.cost / r.visits) : 0;
                const targetMarge = rule.target_margin || 15;
                const isDanger = (r.actual_margin !== null && r.actual_margin < targetMarge);
                const showBot = rule.auto_pilot ? '<span class="bot-icon">🤖</span>' : '';
                return `
                  <tr>
                    <td><b>${escapeHtml(r.offer_id)}</b></td><td>${escapeHtml(r.affiliate_id)}</td><td>${escapeHtml(r.sub_id)}</td>
                    <td>${fmt(r.total)}</td><td>${fmt(r.accepted)}</td><td>${money(r.revenue)}</td>
                    <td style="color:#64748b">${money(r.cost)}</td><td style="font-weight:700; color:${r.profit >= 0 ? '#16a34a' : '#dc2626'}">${money(r.profit)}</td>
                    <td style="font-weight:700;"><div style="display:flex; align-items:center;">${showBot}${pct(r.accepted,r.total).toFixed(1)}%</div></td>
                    <td style="color:#2563eb">${targetMarge}%</td>
                    <td><span class="badge ${isDanger ? 'badge-danger' : 'badge-ok'}">${r.actual_margin ? r.actual_margin.toFixed(1)+'%' : '—'}</span></td>
                    <td style="color:#1e40af; font-weight:700;">${rule.min_cpc > 0 ? money(rule.min_cpc) : '-'}</td>
                    <td style="font-weight:700">${money(epc)}</td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;

      el.querySelector('[data-role=toggle]').addEventListener('click', (e) => {
        const key = e.currentTarget.dataset.key;
        if (OPEN_GROUPS.has(key)) OPEN_GROUPS.delete(key);
        else OPEN_GROUPS.add(key);
        
        el.classList.toggle('collapsed');
        const chev = el.querySelector('.chev');
        chev.style.transform = el.classList.contains('collapsed') ? 'rotate(0deg)' : 'rotate(90deg)';
      });
      return el;
    }

    function renderGrandTotal(allRows){
      let total = 0, accepted = 0, rev = 0, prof = 0;
      allRows.forEach(it => { total += it.total_leads; accepted += it.accepted_leads; rev += (it.revenue || 0); prof += (it.profit || 0); });
      const wrap = document.createElement('div');
      wrap.className = 'total-summary';
      wrap.style.cssText = "padding:16px; background:#1e40af; color:#fff; font-weight:800; border-radius:0 0 8px 8px; display:flex; justify-content:space-between; align-items:center;";
      wrap.innerHTML = `<span>TOTAAL SELECTIE</span><div style="display:flex; gap:25px"><span>Omzet: ${money(rev)}</span><span>Winst: ${money(prof)}</span><span>Leads: ${fmt(total)} (Acc: ${pct(accepted,total).toFixed(1)}%)</span></div>`;
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
