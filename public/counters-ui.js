(() => {
  const API_BASE     = 'https://optimizationtool.vercel.app/api';
  const API_COUNTERS = `${API_BASE}/counters`;
  const API_RULES    = `${API_BASE}/rules`; 

  const mount = document.getElementById('counters-ui');
  if(!mount){ console.error('counters-ui mount not found'); return; }

  mount.innerHTML = `
    <div class="rules-wrap">
      <div class="rules-card">
        <div class="rules-toolbar">
          <span class="rules-label">Admin API • X-Admin-Token</span>
          <input id="c_token" class="rules-input" type="password" style="width:260px" aria-label="Admin token">

          <select id="c_groupmode" class="rules-input" style="width:190px" aria-label="Group by">
            <option value="date">Group: Datum</option>
            <option value="offer">Group: Offer</option>
            <option value="affiliate">Group: Affiliate</option>
            <option value="sub">Group: Sub</option>
          </select>

          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <input id="c_from" class="rules-input" type="date" style="width:170px">
            <input id="c_to"   class="rules-input" type="date" style="width:170px">
            <input id="c_aff"  class="rules-input" type="text" placeholder="Affiliate ID" style="width:170px">
            <input id="c_off"  class="rules-input" type="text" placeholder="Offer ID" style="width:170px">
            <input id="c_sub"  class="rules-input" type="text" placeholder="Sub ID" style="width:200px">
          </div>

          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="rules-btn ghost" data-preset="today"      type="button">Vandaag</button>
            <button class="rules-btn ghost" data-preset="yesterday" type="button">Gisteren</button>
            <button class="rules-btn ghost" data-preset="last7"      type="button">Laatste 7 dagen</button>
            <button class="rules-btn ghost" data-preset="month"      type="button">Deze maand</button>
            <button id="c_run" class="rules-btn" type="button">Toon resultaten</button>
          </div>
        </div>
        <div id="c_groups" style="padding:12px 0"></div>
      </div>
    </div>
  `;

  const $ = (s, r=mount) => r.querySelector(s);
  const fmt = (n)=> new Intl.NumberFormat('nl-NL').format(n);
  const pct = (a,t)=> t>0 ? (100*a/t) : 0;
  const escapeHtml = (s)=> String(s ?? '').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  
  $('#c_token').value = localStorage.getItem('rui_token') || '';
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
    host.innerHTML = `<div class="rules-empty">Laden…</div>`;
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

      if(!rows.length){ host.innerHTML = `<div class="rules-empty">Geen resultaten</div>`; return; }

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
    } catch (e) { host.innerHTML = `<div class="rules-empty">Error: ${e.message}</div>`; }
  }

  function aggregateRows(items){
    const map = new Map();
    for(const it of items){
      const key = `${it.affiliate_id}|${it.offer_id}|${it.sub_id}|${it.rule_id}`;
      const acc = map.get(key) || { 
        affiliate_id: it.affiliate_id, offer_id: it.offer_id, sub_id: it.sub_id, rule_id: it.rule_id,
        total: 0, accepted: 0, actual_margin: it.actual_margin 
      };
      acc.total += Number(it.total_leads || 0);
      acc.accepted += Number(it.accepted_leads || 0);
      map.set(key, acc);
    }
    return [...map.values()];
  }

  function renderGroup(mode, key, items){
    const rows = aggregateRows(items);
    let t_tot=0, t_acc=0;
    rows.forEach(r => { t_tot += r.total; t_acc += r.accepted; });

    const el = document.createElement('div');
    el.className = 'group collapsed';
    el.innerHTML = `
      <div class="group-header" data-role="toggle" style="display:flex; cursor:pointer; padding:10px; border-bottom:1px solid #eee">
        <span class="chev">▸</span>
        <span class="group-title" style="margin-left:8px"><b>${key}</b></span>
        <span style="margin-left:auto; font-size:13px">Totaal: ${fmt(t_tot)} • Acc: ${fmt(t_acc)} • ${pct(t_acc,t_tot).toFixed(1)}%</span>
      </div>
      <div class="group-body" style="padding:10px">
        <table class="rules">
          <thead>
            <tr>
              <th>Affiliate</th><th>Offer</th><th>Sub</th><th>Rule %</th>
              <th>Target Marge</th><th>Actual Marge</th><th>Total</th><th>Accepted</th><th>Accept %</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => {
              const rule = RULES_MAP?.[r.rule_id] || {};
              const target = rule.target_margin || 15;
              const actual = r.actual_margin;
              const color = (actual !== null && actual < target) ? '#d92d20' : '#10916f';
              return `
                <tr>
                  <td>${escapeHtml(r.affiliate_id)}</td><td>${escapeHtml(r.offer_id)}</td><td>${escapeHtml(r.sub_id)}</td>
                  <td>${rule.percent_accept ?? '—'}%</td>
                  <td>${rule.auto_pilot ? '🤖 ' : ''}${target}%</td>
                  <td style="color:${actual !== null ? color : 'inherit'}; font-weight:bold">${actual !== null ? actual.toFixed(1) + '%' : '—'}</td>
                  <td>${fmt(r.total)}</td><td>${fmt(r.accepted)}</td><td>${pct(r.accepted,r.total).toFixed(1)}%</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    el.querySelector('[data-role=toggle]').addEventListener('click', () => {
      el.classList.toggle('collapsed');
      el.querySelector('.chev').style.transform = el.classList.contains('collapsed') ? 'rotate(0deg)' : 'rotate(90deg)';
    });
    return el;
  }

  function renderGrandTotal(allRows){
    let total = 0, accepted = 0;
    allRows.forEach(it => { total += it.total_leads; accepted += it.accepted_leads; });
    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:16px; border-top:2px solid #eee; margin-top:10px; font-size:15px';
    wrap.innerHTML = `<b>Totaal Selectie:</b> ${fmt(total)} leads • ${fmt(accepted)} accepted • <b>${pct(accepted,total).toFixed(1)}%</b>`;
    return wrap;
  }

  mount.addEventListener('click', e => {
    const btn = e.target.closest('[data-preset]');
    if(btn) setPreset(btn.dataset.preset);
  });

  setPreset('last7');
  $('#c_run').addEventListener('click', runCounters);
})();
