// /public/js/counters-ui.js
(() => {
  const API_COUNTERS = 'https://optimizationtool.vercel.app/api/counters';
  const root = document.getElementById('counters-ui');

  root.innerHTML = `
    <div class="filters">
      <div><div class="label">Datum van</div><input id="c_from" type="date" /></div>
      <div><div class="label">Datum t/m</div><input id="c_to" type="date" /></div>
      <div><div class="label">Affiliate ID</div><input id="c_aff" type="text" /></div>
      <div><div class="label">Offer ID</div><input id="c_off" type="text" /></div>
      <div><div class="label">Sub ID</div><input id="c_sub" type="text" placeholder="leeg of 'null'" /></div>
    </div>
    <div class="quick">
      <button class="btn ghost" data-preset="today">Vandaag</button>
      <button class="btn ghost" data-preset="yesterday">Gisteren</button>
      <button class="btn ghost" data-preset="last7">Laatste 7 dagen</button>
      <button class="btn ghost" data-preset="month">Deze maand</button>
      <button id="c_run" class="btn">Toon resultaten</button>
    </div>
    <div class="result">
      <table id="c_table">
        <thead>
          <tr>
            <th>Datum</th><th>Affiliate</th><th>Offer</th><th>Sub</th>
            <th>Total</th><th>Accepted</th><th>Accept %</th>
          </tr>
        </thead>
        <tbody>
          <tr><td colspan="7" style="text-align:center;color:var(--muted);padding:18px">Nog geen resultaten</td></tr>
        </tbody>
      </table>
    </div>
  `;

  const $ = (s, r=root) => r.querySelector(s);
  const fmt = (n)=> new Intl.NumberFormat('nl-NL').format(n);
  const pct = (a,t)=> t>0 ? (100*a/t) : 0;

  function authHeaders(){
    const t = document.getElementById('admintoken')?.value?.trim() || '';
    return {'X-Admin-Token': t, 'Content-Type':'application/json'};
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
    q.set('from', $('#c_from').value);
    q.set('to',   $('#c_to').value);
    if($('#c_aff').value) q.set('affiliate_id', $('#c_aff').value);
    if($('#c_off').value) q.set('offer_id', $('#c_off').value);
    if($('#c_sub').value) q.set('sub_id', $('#c_sub').value);

    const tb = $('#c_table tbody');
    tb.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:16px">Laden…</td></tr>`;

    try{
      const r = await fetch(`${API_COUNTERS}?${q.toString()}`, { headers: authHeaders() });
      if(!r.ok) throw new Error(r.status);
      const j = await r.json();
      const rows = j.items || [];

      if(!rows.length){
        tb.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:16px">Geen resultaten</td></tr>`;
        return;
      }

      let tot=0, acc=0;
      tb.innerHTML = rows.map(it=>{
        const t = Number(it.total_leads||0), a = Number(it.accepted_leads||0);
        tot += t; acc += a;
        const p = pct(a,t);
        return `<tr>
          <td>${it.date || ''}</td>
          <td>${it.affiliate_id ?? '—'}</td>
          <td>${it.offer_id ?? '—'}</td>
          <td>${it.sub_id ?? '—'}</td>
          <td>${fmt(t)}</td>
          <td>${fmt(a)}</td>
          <td>${p.toFixed(1)}%</td>
        </tr>`;
      }).join('') + `
        <tr class="tfoot">
          <td colspan="4" style="text-align:right;padding-right:10px">Totaal</td>
          <td>${fmt(tot)}</td>
          <td>${fmt(acc)}</td>
          <td>${pct(acc,tot).toFixed(1)}%</td>
        </tr>`;
    }catch(e){
      tb.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--danger);padding:16px">Error ${String(e)}</td></tr>`;
    }
  }

  // Wire-up
  root.addEventListener('click', (e)=>{
    const btn = e.target.closest('.btn.ghost[data-preset]'); if(!btn) return;
    setPreset(btn.dataset.preset);
  });
  setPreset('last7');
  $('#c_run').addEventListener('click', runCounters);
})();
