// /public/js/counters-ui.js
(() => {
  const API_BASE = 'https://optimizationtool.vercel.app/api';
  const API_COUNTERS = `${API_BASE}/counters`;

  const mount = document.getElementById('counters-ui');
  if(!mount){ console.error('counters-ui mount not found'); return; }

  mount.innerHTML = `
    <div class="rules-wrap">
      <div class="rules-card">
        <div class="rules-toolbar">
          <span class="rules-label">Admin API • X-Admin-Token</span>
          <input id="c_token" class="rules-input" type="password" style="width:260px" aria-label="Admin token">

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

  // token → localStorage (zoals Rules UI)
  $('#c_token').value = localStorage.getItem('rui_token') || '';
  $('#c_token').addEventListener('change', e=> localStorage.setItem('rui_token', e.target.value.trim()));

  const fmt = (n)=> new Intl.NumberFormat('nl-NL').format(n);
  const pct = (a,t)=> t>0 ? (100*a/t) : 0;
  const escapeHtml = (s)=> String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  function authHeaders(){
    const t = $('#c_token').value.trim() || '';
    return {'X-Admin-Token': t, 'Accept':'application/json'};
  }

  // ---- presets
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

  // ---- data load (per dag groeperen)
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
      const r = await fetch(`${API_COUNTERS}?${q.toString()}`, { headers: authHeaders() });
      if(!r.ok) throw new Error(r.status+' '+r.statusText);
      const j = await r.json();
      const rows = j.items || [];

      if(!rows.length){
        host.innerHTML = `<div class="rules-empty">Geen resultaten</div>`;
        return;
      }

      // group per date
      const groups = {};
      for(const it of rows){
        const d = it.date || '';
        (groups[d] ||= []).push(it);
      }

      const dates = Object.keys(groups).sort((a,b)=> b.localeCompare(a)); // newest first
      host.innerHTML = '';
      for(const date of dates){
        host.appendChild(renderDateGroup(date, groups[date]));
      }
    }catch(e){
      host.innerHTML = `<div class="rules-empty" style="color:#d92d20">Error ${escapeHtml(e.message||String(e))}</div>`;
    }
  }

  function renderDateGroup(date, items){
    // totals
    let tot=0, acc=0;
    for(const it of items){ tot += Number(it.total_leads||0); acc += Number(it.accepted_leads||0); }
    const p = pct(acc, tot);

    const el = document.createElement('div');
    el.className = 'group collapsed';
    el.dataset.date = date;

    el.innerHTML = `
      <div class="group-header" data-role="toggle" role="button" tabindex="0" aria-expanded="false" aria-controls="body-${date}">
        <span class="chev">▸</span>
        <span class="group-title">${escapeHtml(date)}</span>
        <span class="group-sub" style="margin-left:auto">
          Totaal: ${fmt(tot)} • Accepted: ${fmt(acc)} • ${p.toFixed(1)}%
        </span>
      </div>
      <div class="group-body" id="body-${date}">
        <div class="table-wrap" style="margin:0 12px">
          <table class="rules">
            <thead>
              <tr>
                <th>Affiliate</th>
                <th>Offer</th>
                <th>Sub</th>
                <th>Total</th>
                <th>Accepted</th>
                <th>Accept %</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(row => {
                const t = Number(row.total_leads||0), a = Number(row.accepted_leads||0);
                const pp = pct(a,t);
                return `
                  <tr>
                    <td>${escapeHtml(row.affiliate_id ?? '—')}</td>
                    <td>${escapeHtml(row.offer_id ?? '—')}</td>
                    <td>${escapeHtml(row.sub_id ?? '—')}</td>
                    <td>${fmt(t)}</td>
                    <td>${fmt(a)}</td>
                    <td>${pp.toFixed(1)}%</td>
                  </tr>
                `;
              }).join('')}
              <tr class="tfoot">
                <td colspan="3" style="text-align:right;padding-right:10px">Totaal</td>
                <td>${fmt(tot)}</td>
                <td>${fmt(acc)}</td>
                <td>${p.toFixed(1)}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    // toggle
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

  // presets + run
  mount.addEventListener('click', (e)=>{
    const btn = e.target.closest('.rules-btn.ghost[data-preset]'); if(!btn) return;
    setPreset(btn.dataset.preset);
  });
  setPreset('last7');
  $('#c_run').addEventListener('click', runCounters);
})();
