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
            <input id="c_rule" class="rules-input" type="text" placeholder="Rule ID (leeg of 'null')" aria-label="Rule ID" style="width:200px">
          </div>

          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="rules-btn ghost" data-preset="today"     type="button">Vandaag</button>
            <button class="rules-btn ghost" data-preset="yesterday" type="button">Gisteren</button>
            <button class="rules-btn ghost" data-preset="last7"     type="button">Laatste 7 dagen</button>
            <button class="rules-btn ghost" data-preset="month"     type="button">Deze maand</button>
            <button id="c_run" class="rules-btn" type="button">Toon resultaten</button>
          </div>
        </div>

        <div class="table-wrap" style="margin:12px">
          <table class="rules" id="c_table">
            <thead>
              <tr>
                <th>Datum</th><th>Rule</th><th>Affiliate</th><th>Offer</th><th>Sub</th>
                <th>Total</th><th>Accepted</th><th>Accept %</th>
              </tr>
            </thead>
            <tbody>
              <tr><td colspan="8" style="text-align:center;color:var(--muted);padding:18px">Nog geen resultaten</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const $ = (s, r=mount) => r.querySelector(s);
  // token persist (zelfde als Rules UI)
  $('#c_token').value = localStorage.getItem('rui_token') || '';
  $('#c_token').addEventListener('change', e=> localStorage.setItem('rui_token', e.target.value.trim()));

  const fmt = (n)=> new Intl.NumberFormat('nl-NL').format(n);
  const pct = (a,t)=> t>0 ? (100*a/t) : 0;

  function authHeaders(){
    const t = $('#c_token').value.trim() || '';
    return {'X-Admin-Token': t, 'Accept':'application/json'};
  }

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

  async function runCounters(){
    const q = new URLSearchParams();
    // API accepteert date_from/date_to, we sturen die (plus compat voor from/to server-side)
    if($('#c_from').value) q.set('date_from', $('#c_from').value);
    if($('#c_to').value)   q.set('date_to',   $('#c_to').value);
    if($('#c_aff').value)  q.set('affiliate_id', $('#c_aff').value);
    if($('#c_off').value)  q.set('offer_id',     $('#c_off').value);
    if($('#c_sub').value)  q.set('sub_id',       $('#c_sub').value);
    if($('#c_rule').value) q.set('rule_id',      $('#c_rule').value);

    const tb = $('#c_table tbody');
    tb.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:16px">Laden…</td></tr>`;

    try{
      const r = await fetch(`${API_COUNTERS}?${q.toString()}`, { headers: authHeaders() });
      if(!r.ok) throw new Error(r.status+' '+r.statusText);
      const j = await r.json();
      const rows = j.items || [];

      if(!rows.length){
        tb.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:16px">Geen resultaten</td></tr>`;
        return;
      }

      let tot=0, acc=0;
      tb.innerHTML = rows.map(it=>{
        const t = Number(it.total_leads||0), a = Number(it.accepted_leads||0);
        tot += t; acc += a;
        const p = pct(a,t);
        return `<tr>
          <td>${it.date || ''}</td>
          <td>${it.rule_id ?? '—'}</td>
          <td>${it.affiliate_id ?? '—'}</td>
          <td>${it.offer_id ?? '—'}</td>
          <td>${it.sub_id ?? '—'}</td>
          <td>${fmt(t)}</td>
          <td>${fmt(a)}</td>
          <td>${p.toFixed(1)}%</td>
        </tr>`;
      }).join('') + `
        <tr class="tfoot">
          <td colspan="5" style="text-align:right;padding-right:10px">Totaal</td>
          <td>${fmt(tot)}</td>
          <td>${fmt(acc)}</td>
          <td>${pct(acc,tot).toFixed(1)}%</td>
        </tr>`;
    }catch(e){
      tb.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--danger);padding:16px">Error ${String(e.message||e)}</td></tr>`;
    }
  }

  // Presets + run
  mount.addEventListener('click', (e)=>{
    const btn = e.target.closest('.rules-btn.ghost[data-preset]'); if(!btn) return;
    setPreset(btn.dataset.preset);
  });
  setPreset('last7');
  $('#c_run').addEventListener('click', runCounters);
})();
