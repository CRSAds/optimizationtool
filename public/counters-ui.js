(function() {
  const API_BASE     = 'https://optimizationtool.vercel.app/api';
  const API_COUNTERS = `${API_BASE}/counters`;
  const API_RULES    = `${API_BASE}/rules`; 

  function startApp() {
    const mount = document.getElementById('counters-ui');
    if(!mount) return;

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

          <div class="table-wrap">
             <div id="c_groups" style="padding-bottom:20px"></div>
          </div>
        </div>
      </div>
    `;

    const $ = (s) => mount.querySelector(s);
    
    // Formatters
    const fmt = (n)=> new Intl.NumberFormat('nl-NL').format(n);
    const money = (n)=> new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n);
    const pct = (a,t)=> t>0 ? (100*a/t) : 0;
    const escapeHtml = (s)=> String(s ?? '').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
    
    $('#c_token').value = localStorage.getItem('rui_token') || 'ditiseenlanggeheimtoken';
    $('#c_token').addEventListener('change', e=> localStorage.setItem('rui_token', e.target.value.trim()));

    const selMode = $('#c_groupmode');
    selMode.value = localStorage.getItem('c_groupmode') || 'date';
    selMode.addEventListener('change', ()=> {
      localStorage.setItem('c_groupmode', selMode.value);
      runCounters();
    });

    function setPreset(which){
      const d = new Date(); const pad = n=> String(n).padStart(2,'0');
      const toIso = (dt)=> `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
      let from = new Date(d), to = new Date(d);
      if(which==='yesterday'){ from.setDate(d.getDate()-1); to.setDate(d.getDate()-1); }
      if(which==='last7'){ from.setDate(d.getDate()-6); }
      if(which==='month'){ from = new Date(d.getFullYear(), d.getMonth(), 1); }
      $('#c_from').value = toIso(from);
      $('#c_to').value   = toIso(to);
    }

    let RULES_MAP = null;
    async function ensureRules(){
      if(RULES_MAP) return RULES_MAP;
      try {
        const r = await fetch(API_RULES, { headers: { 'X-Admin-Token': $('#c_token').value.trim() } });
        const j = await r.json();
        RULES_MAP = {};
        (j.items || []).forEach(it => {
          RULES_MAP[it.id] = { auto_pilot: !!it.auto_pilot, target_margin: Number(it.target_margin || 15), percent_accept: it.percent_accept };
        });
      } catch { RULES_MAP = {}; }
      return RULES_MAP;
    }

    async function runCounters(){
      const host = $('#c_groups');
      host.innerHTML = `<div style="padding:20px;text-align:center;color:#64748b">Laden…</div>`;
      try {
        await ensureRules();
        const q = new URLSearchParams({ 
          date_from: $('#c_from').value, 
          date_to: $('#c_to').value,
          affiliate_id: $('#c_aff').value,
          offer_id: $('#c_off').value,
          sub_id: $('#c_sub').value
        });

        const r = await fetch(`${API_COUNTERS}?${q.toString()}`, { headers: { 'X-Admin-Token': $('#c_token').value.trim() } });
        const j = await r.json();
        const rows = j.items || [];

        if(!rows.length){ host.innerHTML = `<div style="padding:20px;text-align:center">Geen resultaten</div>`; return; }

        const mode = $('#c_groupmode').value;
        const grouped = {};
        rows.forEach(it => {
          const key = mode === 'date' ? it.date : (it[mode + '_id'] || '—');
          (grouped[key] ||= []).push(it);
        });

        host.innerHTML = '';
        Object.keys(grouped).sort((a,b)=> (mode==='date' ? b.localeCompare(a) : a.localeCompare(b))).forEach(k => {
          host.appendChild(renderGroup(mode, k, grouped[k]));
        });
        
        host.appendChild(renderGrandTotal(rows));
        
      } catch (e) { host.innerHTML = `<div style="padding:20px;color:red">Error: ${e.message}</div>`; }
    }

    function aggregateRows(items){
      const map = new Map();
      for(const it of items){
        const key = `${it.affiliate_id}|${it.offer_id}|${it.sub_id}|${it.rule_id}`;
        const acc = map.get(key) || { 
          affiliate_id: it.affiliate_id, offer_id: it.offer_id, sub_id: it.sub_id, rule_id: it.rule_id,
          total: 0, accepted: 0, actual_margin: it.actual_margin,
          revenue: 0, cost: 0, profit: 0
        };
        acc.total += Number(it.total_leads || 0);
        acc.accepted += Number(it.accepted_leads || 0);
        // Euro's optellen
        acc.revenue += Number(it.revenue || 0);
        acc.cost    += Number(it.cost || 0);
        acc.profit  += Number(it.profit || 0);

        map.set(key, acc);
      }
      return [...map.values()];
    }

    function renderGroup(mode, key, items){
      const rows = aggregateRows(items);
      let t_tot=0, t_acc=0, t_rev=0, t_prof=0;
      rows.forEach(r => { 
          t_tot += r.total; 
          t_acc += r.accepted; 
          t_rev += r.revenue;
          t_prof += r.profit;
      });

      const el = document.createElement('div');
      el.className = 'group collapsed'; 
      el.innerHTML = `
        <div class="group-header" data-role="toggle">
          <span class="chev">▶</span>
          <span><b>${key}</b></span>
          <div style="margin-left:auto; display:flex; gap:15px; font-size:12px; font-weight:400; color:#64748b; align-items:center">
             <span>Rev: <b>${money(t_rev)}</b></span>
             <span>Profit: <b style="color:${t_prof >= 0 ? '#16a34a':'#dc2626'}">${money(t_prof)}</b></span>
             <span style="border-left:1px solid #cbd5e1; padding-left:15px">Total: <b>${fmt(t_tot)}</b> • Acc: <b>${fmt(t_acc)}</b> (${pct(t_acc,t_tot).toFixed(1)}%)</span>
          </div>
        </div>
        <div class="group-body">
          <table class="rules">
             <colgroup>
               <col style="width:70px"><col style="width:70px"><col style="width:70px"> <col style="width:60px"> <col style="width:60px"> <col style="width:80px"> <col style="width:80px"> <col style="width:80px"> <col style="width:80px"> <col style="width:60px"><col style="width:60px"><col style="width:60px"> </colgroup>
            <thead>
              <tr>
                <th>Aff</th><th>Off</th><th>Sub</th>
                <th>Rule</th><th>Target</th><th>Marge %</th>
                <th>Omzet</th><th>Kosten</th><th>Winst</th>
                <th>Total</th><th>Acc</th><th>Acc %</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => {
                const rule = RULES_MAP?.[r.rule_id] || {};
                const target = rule.target_margin || 15;
                const actual = r.actual_margin;
                
                const isDanger = (actual !== null && actual < target);
                const marginBadge = actual !== null 
                  ? `<span class="badge ${isDanger ? 'badge-danger' : 'badge-ok'}">${actual.toFixed(1)}%</span>`
                  : '—';
                
                const autoIcon = rule.auto_pilot ? '🤖 ' : '';

                return `
                  <tr>
                    <td>${escapeHtml(r.affiliate_id)}</td>
                    <td>${escapeHtml(r.offer_id)}</td>
                    <td>${escapeHtml(r.sub_id)}</td>
                    <td style="color:#64748b">${rule.percent_accept ?? '—'}%</td>
                    <td style="font-weight:600;color:#2563eb">${autoIcon}${target}%</td>
                    <td>${marginBadge}</td>
                    
                    <td>${money(r.revenue)}</td>
                    <td style="color:#64748b">${money(r.cost)}</td>
                    <td style="font-weight:700; color:${r.profit >= 0 ? '#16a34a' : '#dc2626'}">${money(r.profit)}</td>

                    <td>${fmt(r.total)}</td>
                    <td>${fmt(r.accepted)}</td>
                    <td style="font-weight:600">${pct(r.accepted,r.total).toFixed(1)}%</td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;

      el.querySelector('[data-role=toggle]').addEventListener('click', () => {
        el.classList.toggle('collapsed');
        const chev = el.querySelector('.chev');
        chev.style.transform = el.classList.contains('collapsed') ? 'rotate(0deg)' : 'rotate(90deg)';
      });
      return el;
    }

    function renderGrandTotal(allRows){
      let total = 0, accepted = 0, rev = 0, prof = 0;
      allRows.forEach(it => { 
          total += it.total_leads; 
          accepted += it.accepted_leads;
          rev += (it.revenue || 0);
          prof += (it.profit || 0);
      });
      
      const wrap = document.createElement('div');
      wrap.className = 'total-summary';
      wrap.innerHTML = `
        <span>TOTAAL SELECTIE</span>
        <div style="display:flex; gap:20px">
           <span>Omzet: ${money(rev)}</span>
           <span>Winst: ${money(prof)}</span>
           <span>Leads: ${fmt(total)} • Acc: ${fmt(accepted)} (${pct(accepted,total).toFixed(1)}%)</span>
        </div>
      `;
      return wrap;
    }

    mount.addEventListener('click', e => {
      const btn = e.target.closest('[data-preset]');
      if(btn) setPreset(btn.dataset.preset);
    });

    setPreset('last7');
    $('#c_run').addEventListener('click', runCounters);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startApp);
  else startApp();
})();
