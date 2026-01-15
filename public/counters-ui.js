(() => {
  const API_BASE     = 'https://optimizationtool.vercel.app/api';
  const API_COUNTERS = `${API_BASE}/counters`;
  const API_RULES    = `${API_BASE}/rules`; 

  const mount = document.getElementById('counters-ui');
  if(!mount){ console.error('counters-ui mount not found'); return; }

  // UI skeleton
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
            <input id="c_from" class="rules-input" type="date" aria-label="Datum van" style="width:170px">
            <input id="c_to"   class="rules-input" type="date" aria-label="Datum t/m" style="width:170px">
            <input id="c_aff"  class="rules-input" type="text" placeholder="Affiliate ID" aria-label="Affiliate ID" style="width:170px">
            <input id="c_off"  class="rules-input" type="text" placeholder="Offer ID" aria-label="Offer ID" style="width:170px">
            <input id="c_sub"  class="rules-input" type="text" placeholder="Sub ID (leeg of 'null')" aria-label="Sub ID" style="width:200px">
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

  $('#c_token').value = localStorage.getItem('rui_token') || '';
  $('#c_token').addEventListener('change', e=> localStorage.setItem('rui_token', e.target.value.trim()));

  const selMode = $('#c_groupmode');
  selMode.value = localStorage.getItem('c_groupmode') || 'date';
  selMode.addEventListener('change', ()=> {
    localStorage.setItem('c_groupmode', selMode.value);
    runCounters();
  });

  const fmt = (n)=> new Intl.NumberFormat('nl-NL').format(n);
  const pct = (a,t)=> t>0 ? (100*a/t) : 0;
  const escapeHtml = (s)=> String(s ?? '').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  
  function authHeaders(){
    const t = $('#c_token').value.trim() || '';
    return {'X-Admin-Token': t, 'Accept':'application/json'};
  }
  
  const keyOrDash = v => (v===''||v===null||v===undefined) ? '—' : String(v);
  function cssId(s){ return String(s).replace(/\s+/g,'-').replace(/[^a-zA-Z0-9_-]/g,''); }

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
    try{
      const r = await fetch(API_RULES, { headers: authHeaders() });
      const j = await r.json();
      RULES_MAP = {};
      (j.items || []).forEach(it => {
        if(it.id) {
          RULES_MAP[it.id] = { 
            percent_accept: Number(it.percent_accept ?? 0),
            auto_pilot: !!it.auto_pilot,
            target_margin: Number(it.target_margin || 15)
          };
        }
      });
    }catch{ RULES_MAP = {}; }
    return RULES_MAP;
  }

  async function runCounters(){
    const q = new URLSearchParams();
    if($('#c_from').value) q.set('date_from', $('#c_from').value);
    if($('#c_to').value)   q.set('date_to',   $('#c_to').value);
    if($('#c_aff').value)  q.set('affiliate_id', $('#c_aff').value);
    if($('#c_off').value)  q.set('offer_id',     $('#c_off').value);
    if($('#c_sub').value)  q.set('sub_id',       $('#c_sub').value);

    const host = $('#c_groups');
    host.innerHTML = `<div class="rules-empty">Laden…</div>`;

    try{
      await ensureRules();
      const r = await fetch(`${API_COUNTERS}?${q.toString()}`, { headers: authHeaders() });
      const j = await r.json();
      const rows = j.items || [];

      if(!rows.length){ host.innerHTML = `<div class="rules-empty">Geen resultaten</div>`; return; }

      const mode = $('#c_groupmode').value;
      const grouped = groupByMode(rows, mode);
      const keys = Object.keys(grouped).sort((a,b)=> groupKeySort(a,b,mode));

      host.innerHTML = '';
      for(const k of keys){ host.appendChild(renderGroup(mode, k, grouped[k])); }
      host.appendChild(renderGrandTotal(rows));
    } catch(e) {
      host.innerHTML = `<div class="rules-empty" style="color:#d92d20">Error ${escapeHtml(e.message)}</div>`;
    }
  }

  function groupKeySort(a,b,mode){
    if(mode==='date') return b.localeCompare(a); 
    if(a==='—' && b!=='—') return 1;
    if(b==='—' && a!=='—') return -1;
    return String(a).localeCompare(String(b), 'nl');
  }

  function groupByMode(rows, mode){
    const m = {};
    for(const it of rows){
      const key = mode==='date' ? keyOrDash(it.date) : keyOrDash(it[mode + '_id']);
      (m[key] ||= []).push(it);
    }
    return m;
  }

  function aggregateRows(items){
    const map = new Map();
    for(const it of items){
      const aff = keyOrDash(it.affiliate_id);
      const off = keyOrDash(it.offer_id);
      const sub = keyOrDash(it.sub_id);
      const rid = it.rule_id;
      const key = `${aff}|${off}|${sub}|${rid}`;
      
      const acc = map.get(key) || { 
        affiliate_id: aff, offer_id: off, sub_id: sub, rule_id: rid,
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
      <div class="group-header" data-role="toggle" style="display:flex; cursor:pointer">
        <span class="chev">▸</span>
        <span class="group-title" style="margin-left:8px"><b>${key}</b></span>
        <span style="margin-left:auto">Totaal: ${fmt(t_tot)} • Acc: ${fmt(t_acc)} • ${pct(t_acc,t_tot).toFixed(1)}%</span>
      </div>
      <div class="group-body" style="padding:10px">
        <table class="rules">
          <thead>
            <tr>
              <th>Affiliate</th><th>Offer</th><th>Sub</th>
              <th>Rule %</th><th>Target Marge</th><th>Actual Marge</th>
              <th>Total</th><th>Accepted</th><th>Accept %</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => {
              const rule = RULES_MAP?.[r.rule_id] || {};
              const actualPct = pct(r.accepted, r.total);
              const targetMargin = rule.target_margin || 15;
              const actualMargin = r.actual_margin;
              const color = (actualMargin !== null && actualMargin < targetMargin) ? '#d92d20' : '#10916f';
              
              return `
                <tr>
                  <td>${escapeHtml(r.affiliate_id)}</td>
                  <td>${escapeHtml(r.offer_id)}</td>
                  <td>${escapeHtml(r.sub_id)}</td>
                  <td>${rule.percent_accept ?? '—'}%</td>
                  <td>${rule.auto_pilot ? '🤖 ' : ''}${targetMargin}%</td>
                  <td style="color:${actualMargin !== null ? color : 'inherit'}; font-weight:bold">
                    ${actualMargin !== null ? actualMargin.toFixed(1) + '%' : '—'}
                  </td>
                  <td>${fmt(r.total)}</td>
                  <td>${fmt(r.accepted)}</td>
                  <td>${actualPct.toFixed(1)}%</td>
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
    wrap.style.padding = '10px';
    wrap.innerHTML = `<b>Totaal Selectie:</b> ${fmt(total)} leads • ${fmt(accepted)} accepted • ${pct(accepted,total).toFixed(1)}%`;
    return wrap;
  }

  mount.addEventListener('click', e => {
    const btn = e.target.closest('[data-preset]');
    if(btn) setPreset(btn.dataset.preset);
  });

  setPreset('last7');
  $('#c_run').addEventListener('click', runCounters);
})();
