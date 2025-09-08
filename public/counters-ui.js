// /public/js/counters-ui.js
(() => {
  const API_BASE     = 'https://optimizationtool.vercel.app/api';
  const API_COUNTERS = `${API_BASE}/counters`;
  const API_RULES    = `${API_BASE}/rules`; // voor rule.percent_accept

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
            <button class="rules-btn ghost" data-preset="today"     type="button">Vandaag</button>
            <button class="rules-btn ghost" data-preset="yesterday" type="button">Gisteren</button>
            <button class="rules-btn ghost" data-preset="last7"     type="button">Laatste 7 dagen</button>
            <button class="rules-btn ghost" data-preset="month"     type="button">Deze maand</button>
            <button id="c_run" class="rules-btn" type="button">Toon resultaten</button>
          </div>
        </div>

        <div id="c_groups" style="padding:12px 0"></div>
      </div>
    </div>
  `;

  const $ = (s, r=mount) => r.querySelector(s);

  // Token hergebruiken zoals Rules UI
  $('#c_token').value = localStorage.getItem('rui_token') || '';
  $('#c_token').addEventListener('change', e=> localStorage.setItem('rui_token', e.target.value.trim()));

  // Group mode persist
  const selMode = $('#c_groupmode');
  selMode.value = localStorage.getItem('c_groupmode') || 'date';
  selMode.addEventListener('change', ()=> {
    localStorage.setItem('c_groupmode', selMode.value);
    runCounters();
  });

  // utils
  const fmt = (n)=> new Intl.NumberFormat('nl-NL').format(n);
  const pct = (a,t)=> t>0 ? (100*a/t) : 0;
  const escapeHtml = (s)=> String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  function authHeaders(){
    const t = $('#c_token').value.trim() || '';
    return {'X-Admin-Token': t, 'Accept':'application/json'};
  }
  const keyOrDash = v => (v===''||v===null||v===undefined) ? '—' : String(v);
  function cssId(s){ return String(s).replace(/\s+/g,'-').replace(/[^a-zA-Z0-9_-]/g,''); }

  // Date presets
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

  // rules lookup: id -> {percent_accept}
  let RULES_MAP = null;
  async function ensureRules(){
    if(RULES_MAP) return RULES_MAP;
    try{
      const r = await fetch(API_RULES, { headers: authHeaders() });
      if(!r.ok) throw 0;
      const j = await r.json();
      const items = j.items || [];
      RULES_MAP = {};
      for(const it of items){
        if(it.id) RULES_MAP[it.id] = { percent_accept: Number(it.percent_accept ?? 0) };
      }
    }catch{ RULES_MAP = {}; }
    return RULES_MAP;
  }

  // Data load
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
      if(!r.ok) throw new Error(r.status+' '+r.statusText);
      const j = await r.json();
      const rows = j.items || [];

      if(!rows.length){
        host.innerHTML = `<div class="rules-empty">Geen resultaten</div>`;
        return;
      }

      const mode = $('#c_groupmode').value; // date | offer | affiliate | sub
      const grouped = groupByMode(rows, mode);
      const keys = Object.keys(grouped).sort((a,b)=> groupKeySort(a,b,mode));

      host.innerHTML = '';
      for(const k of keys){
        host.appendChild(renderGroup(mode, k, grouped[k]));
      }

      // totaal selectie
      host.appendChild(renderGrandTotal(rows));

    }catch(e){
      host.innerHTML = `<div class="rules-empty" style="color:#d92d20">Error ${escapeHtml(e.message||String(e))}</div>`;
    }
  }

  // Group helpers
  function groupKeySort(a,b,mode){
    if(mode==='date') return b.localeCompare(a); // nieuwste boven
    if(a==='—' && b!=='—') return 1;
    if(b==='—' && a!=='—') return -1;
    const na = Number(a), nb = Number(b);
    if(!Number.isNaN(na) && !Number.isNaN(nb)) return na-nb;
    return String(a).localeCompare(String(b), 'nl');
  }
  function groupByMode(rows, mode){
    const m = {};
    for(const it of rows){
      const key =
        mode==='offer'     ? keyOrDash(it.offer_id) :
        mode==='affiliate' ? keyOrDash(it.affiliate_id) :
        mode==='sub'       ? keyOrDash(it.sub_id) :
        keyOrDash(it.date);
      (m[key] ||= []).push(it);
    }
    return m;
  }
  function groupTitle(mode, key){
    if(mode==='offer')     return `Offer: ${escapeHtml(key)}`;
    if(mode==='affiliate') return `Affiliate: ${escapeHtml(key)}`;
    if(mode==='sub')       return `Sub: ${escapeHtml(key)}`;
    return escapeHtml(key);
  }

  // combineer per (affiliate_id, offer_id, sub_id, rulePercent)
  function aggregateRows(items){
    const map = new Map();
    for(const it of items){
      const aff = keyOrDash(it.affiliate_id);
      const off = keyOrDash(it.offer_id);
      const sub = keyOrDash(it.sub_id);
      const rp  = RULES_MAP?.[it.rule_id]?.percent_accept;
      const rps = (rp===0 || rp) ? String(rp) : '—';
      const key = `${aff}|${off}|${sub}|${rps}`;
      const acc = map.get(key) || { affiliate_id: aff, offer_id: off, sub_id: sub, rule_percent: (rps==='—'?null:Number(rp)), total: 0, accepted: 0 };
      acc.total    += Number(it.total_leads || 0);
      acc.accepted += Number(it.accepted_leads || 0);
      map.set(key, acc);
    }
    return [...map.values()];
  }

  function renderGroup(mode, key, items){
    const rows = aggregateRows(items);
    let tot=0, acc=0;
    for(const r of rows){ tot += r.total; acc += r.accepted; }
    const p = pct(acc, tot);

    const el = document.createElement('div');
    el.className = 'group collapsed';
    el.dataset.key = key;
    el.dataset.mode = mode;

    el.innerHTML = `
      <div class="group-header" data-role="toggle" role="button" tabindex="0" aria-expanded="false" aria-controls="body-${mode}-${cssId(key)}">
        <span class="chev">▸</span>
        <span class="group-title">${groupTitle(mode, key)}</span>
        <span class="group-sub" style="margin-left:auto">Totaal: ${fmt(tot)} • Accepted: ${fmt(acc)} • ${p.toFixed(1)}%</span>
      </div>
      <div class="group-body" id="body-${mode}-${cssId(key)}">
        <div class="table-wrap" style="margin:0 12px">
          <table class="rules">
            <thead>
              <tr>
                <th>Affiliate</th>
                <th>Offer</th>
                <th>Sub</th>
                <th>Rule % (config)</th>
                <th>Total</th>
                <th>Accepted</th>
                <th>Accept %</th>
                <th>Δ</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r=>{
                const actual = pct(r.accepted, r.total);
                const cfg    = (r.rule_percent===0 || r.rule_percent) ? Number(r.rule_percent) : null;
                const delta  = (cfg===null) ? null : (actual - cfg);
                return `
                  <tr>
                    <td>${escapeHtml(r.affiliate_id)}</td>
                    <td>${escapeHtml(r.offer_id)}</td>
                    <td>${escapeHtml(r.sub_id)}</td>
                    <td>${cfg===null ? '—' : (cfg.toFixed(0)+'%')}</td>
                    <td>${fmt(r.total)}</td>
                    <td>${fmt(r.accepted)}</td>
                    <td>${actual.toFixed(1)}%</td>
                    <td>${delta===null ? '—' : (delta>=0 ? '+' : '')}${delta?.toFixed(1)}%</td>
                  </tr>`;
              }).join('')}
              <tr class="subtotal">
                <td colspan="4" style="text-align:right;padding-right:10px">Totaal</td>
                <td>${fmt(tot)}</td>
                <td>${fmt(acc)}</td>
                <td>${p.toFixed(1)}%</td>
                <td>—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    const toggle = el.querySelector('[data-role=toggle]');
    toggle.addEventListener('click', ()=>{
      el.classList.toggle('collapsed');
      const exp = !el.classList.contains('collapsed');
      toggle.setAttribute('aria-expanded', String(exp));
      el.querySelector('.chev').style.transform = exp ? 'rotate(90deg)' : 'rotate(0deg)';
    });
    toggle.addEventListener('keydown', (e)=>{
      if(e.key==='Enter' || e.key===' '){ e.preventDefault(); toggle.click(); }
    });

    return el;
  }

  function renderGrandTotal(allRows){
    let total = 0, accepted = 0;
    for(const it of allRows){
      total    += Number(it.total_leads || 0);
      accepted += Number(it.accepted_leads || 0);
    }
    const p = pct(accepted, total);

    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.style.margin = '12px';

    wrap.innerHTML = `
      <table class="rules">
        <tbody>
          <tr class="total">
            <td style="text-align:right;padding-right:10px;font-weight:700">Totaal selectie</td>
            <td style="width:140px">${fmt(total)}</td>
            <td style="width:140px">${fmt(accepted)}</td>
            <td style="width:140px">${p.toFixed(1)}%</td>
          </tr>
        </tbody>
      </table>
    `;
    return wrap;
  }

  mount.addEventListener('click', (e)=>{
    const btn = e.target.closest('.rules-btn.ghost[data-preset]'); if(!btn) return;
    setPreset(btn.dataset.preset);
  });
  setPreset('last7');
  $('#c_run').addEventListener('click', runCounters);
})();
