/* ===== NAV ===== */
function setNav(){
  const nav = document.getElementById('nav');
  const hash = location.hash || '#/';
  const links = [
    {href:'#/',label:'Home'},
    {href:'#/topics',label:'Topics'},
    {href:'#/board',label:'Board'}
  ];
  nav.innerHTML = links.map(a =>
    `<a href="${a.href}" ${hash===a.href ? "aria-current='page'" : ""}>${a.label}</a>`
  ).join('');
}
setNav();
window.addEventListener('hashchange', ()=>{ setNav(); route(); });

/* ===== HELPERS ===== */
function esc(s){ return (s||'').replace(/[&<>]/g, c => ({'&':'&','<':'&lt;','>':'&gt;'}[c])); }
function usDateToISO(mmddyyyy){
  if(!mmddyyyy) return '';
  if(/\d{4}-\d{2}-\d{2}/.test(mmddyyyy)) return mmddyyyy;
  const m = mmddyyyy.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(!m) return mmddyyyy;
  return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
}
function buildDateTime(dateStr, timeStr){
  const t = (timeStr && timeStr.trim()) ? timeStr.trim() : '12:30';
  return new Date(`${usDateToISO(dateStr)}T${t}`);
}
function showError(e){
  document.getElementById('app').innerHTML =
    `<div class="error"><strong>Data load failed</strong>\n${esc(e.message)}\n\nCheck /data files and hard refresh (Ctrl/Cmd+Shift+R).</div>`;
  console.error(e);
}
function renderAboutHTML(about) {
  if (Array.isArray(about)) return about.map(p => `<p>${esc(p)}</p>`).join('');
  if (typeof about !== 'string' || !about.trim()) return '<p class="muted">No description provided.</p>';
  return about.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g,'<br>')}</p>`).join('');
}
function slugify(s){
  return (s||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'topic';
}

/* ===== CSV PARSER ===== */
function parseCSV(text){
  const out = []; let row = [], field = ''; let i = 0, q = false;
  while (i < text.length) {
    const c = text[i], n = text[i+1];
    if (q){ if (c === '"'){ if(n === '"'){ field+='"'; i+=2; continue; } q=false; i++; continue; }
             field += c; i++; continue; }
    if (c === '"'){ q = true; i++; continue; }
    if (c === ','){ row.push(field); field=''; i++; continue; }
    if (c === '\n' || c === '\r'){
      if (field !== '' || row.length){ row.push(field); out.push(row); }
      row=[]; field=''; if (c === '\r' && n === '\n') i+=2; else i+=1; continue;
    }
    field += c; i++;
  }
  if (field !== '' || row.length){ row.push(field); out.push(row); }
  if (!out.length) return [];
  const headers = out[0].map(h => h.trim());
  return out.slice(1).filter(r => r.length).map(r => {
    const obj = {}; headers.forEach((h, idx) => { obj[h] = (r[idx] || '').trim(); }); return obj;
  });
}

/* ===== LOADERS (cache-busted so Canvas shows fresh) ===== */
const BUST = `v=${Date.now()}`;
const bust = (u) => u + (u.includes('?') ? '&' : '?') + BUST;

async function loadJSON(path){
  const r = await fetch(bust(path), {cache:'no-store'});
  if(!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  try { return await r.json(); } catch { throw new Error(`${path} → invalid JSON`); }
}
async function loadCSV(path){
  const r = await fetch(bust(path), {cache:'no-store'});
  if(!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  const txt = await r.text();
  return parseCSV(txt);
}
async function loadMeetings(){
  try {
    const rows = await loadCSV('data/meetings.csv');
    return rows.map(x => ({
      date: x.date || x.day || '',
      time: (x.time || '').trim(),
      duration: (x.duration || '').trim(),
      type: x.type || x.kind || '',
      room: x.room || x.place || x.location || '',
      cancelled: (x.cancelled || '').toString().toLowerCase() === 'true'
    }));
  } catch {
    const js = await loadJSON('data/meetings.json');
    return (js || []).map(m => ({
      date: m.date || m.day || '',
      time: (m.time || '').trim(),
      duration: (m.duration || '').trim(),
      type: m.type || m.kind || '',
      room: m.room || m.place || m.location || '',
      cancelled: !!m.cancelled
    }));
  }
}

/* ===== SHARED TOPIC PREVIEW (no arrows on pills) ===== */
function previewPill(label, url){
  if (!url) return `<span class="pill">${esc(label)}</span>`;
  return `<a class="pill link" href="${url}" target="_blank" rel="noopener">${esc(label)}</a>`;
}
function normalizeLabelFromURL(url){
  try{
    const u = new URL(url);
    const last = (u.pathname.split('/').filter(Boolean).pop() || '').split('.')[0];
    return last || u.hostname.replace(/^www\./,'');
  }catch{ return url; }
}

function topicPreviewHTML(t, slug, { showResearch=true, showDebate=true } = {}){
  const title = t.topic || t.title || 'Untitled Topic';

  // resources (as pills, no arrows)
  const res = Array.isArray(t.resources) ? t.resources : [];
  const resHTML = res.length
    ? `<div class="pills">${res.map(e => previewPill(e.name||e.label||'Link', e.url)).join('')}</div>`
    : '<span class="pill">No resources</span>';

  // research preview (two pills, no arrows; “All … →” keeps arrow)
  let researchBlock = '';
  if (showResearch){
    const rl = Array.isArray(t.research_links) ? t.research_links : [];
    const prev = rl.slice(0,2).map(item=>{
      const url = typeof item === 'string' ? item : item.url;
      const label = typeof item === 'string'
        ? normalizeLabelFromURL(item)
        : (item.name || item.label || normalizeLabelFromURL(item.url));
      return previewPill(label, url);
    }).join('');
    researchBlock = rl.length
      ? `<div class="pills">${prev}</div>
         <div style="margin-top:6px;"><a href="#/topic/${encodeURIComponent(slug)}">All research links →</a></div>`
      : `<div class="muted">No research links</div>`;
  }

  // debate notes preview (links + text pills; “All … →” keeps arrow)
  let debateBlock = '';
  if (showDebate){
    const dn = Array.isArray(t.debate_notes) ? t.debate_notes : [];
    const pills = dn.slice(0,2).map(n=>{
      if (typeof n === 'string') return `<span class="pill">${esc(n)}</span>`;
      if (n && n.url){
        const label = n.label || normalizeLabelFromURL(n.url);
        return previewPill(label, n.url);
      }
      return '';
    }).join('');
    debateBlock = dn.length
      ? `<div class="pills">${pills}</div>
         <div style="margin-top:6px;"><a href="#/topic/${encodeURIComponent(slug)}">All notes →</a></div>`
      : `<div class="muted">No notes yet</div>`;
  }

  return `
    <div><strong>${esc(title)}</strong></div>
    <div class="muted" style="margin-top:10px;">Resources:</div>
    ${resHTML}
    <div class="muted" style="margin-top:10px;">Research Links:</div>
    ${researchBlock}
    <div class="muted" style="margin-top:10px;">Debate Notes:</div>
    ${debateBlock}
    <div style="margin-top:8px;"><a href="#/topic/${encodeURIComponent(slug)}">Open topic page →</a></div>
  `;
}

/* ===== PAGES ===== */
function renderBanner(site){
  const root = document.getElementById('banner-root');
  const until = site.cancel_until ? usDateToISO(site.cancel_until) : null;
  const msg = site.cancel_all_upcoming ? 'All upcoming meetings are cancelled until further notice.'
            : (until ? `All meetings are cancelled through ${esc(site.cancel_until)}.` : '');
  root.innerHTML = (site.cancel_all_upcoming || until) ? `<div class="banner">${msg}</div>` : '';
}

async function renderHome(){
  try{
    const [site, meetings, topics] = await Promise.all([
      loadJSON('data/site.json'),
      loadMeetings(),
      loadJSON('data/topics.json')
    ]);
    renderBanner(site);

    const upcoming = meetings
      .filter(m => buildDateTime(m.date, m.time) >= new Date())
      .sort((a,b) => buildDateTime(a.date,a.time) - buildDateTime(b.date,b.time))[0];

    const next = upcoming ? `
      <div class="hero">
        <h2>Next Meeting <span class="pill ok">${esc(upcoming.type || 'Meeting')}</span></h2>
        <div class="muted">
          ${buildDateTime(upcoming.date,upcoming.time).toLocaleString([], {weekday:'long', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit'})}
          ${upcoming.duration ? ` · Duration: <strong>${esc(upcoming.duration)}</strong>` : ''}
        </div>
        <div class="muted">Room: <strong>${esc(upcoming.room)}</strong></div>
      </div>` :
      `<div class="hero"><h2>No upcoming meeting found</h2><div class="muted">Add one in <code>data/meetings.csv</code> or <code>data/meetings.json</code>.</div></div>`;

    const list = Array.isArray(topics) ? topics : [];
    const current = list[0] || null;
    const slug = current ? (current.slug || slugify(current.topic)) : null;

    document.getElementById('app').innerHTML = `${next}
      <div class="grid">
        <article class="card">
          <h3>Current Topic</h3>
          ${current ? topicPreviewHTML(current, slug, {showResearch:true, showDebate:true}) : '<p class="muted">No topics yet.</p>'}
        </article>

        <article class="card">
          <h3>Resources</h3>
          <div>${(site.resources || []).map(r => `<div><a href="${r.url}" target="_blank" rel="noopener">${esc(r.label || r.name || r.url)}</a></div>`).join('')}</div>
        </article>
      </div>`;
  }catch(e){ showError(e); }
}

async function renderTopics(){
  try{
    const topics = await loadJSON('data/topics.json');
    const list = Array.isArray(topics) ? topics : [];

    const current = list[0];
    const previous = list.slice(1);
    const cslug = current ? (current.slug || slugify(current.topic)) : null;

    // Current section: header OUTSIDE the card
    const currentSection = current
      ? `
        <section>
          <h3 style="margin-top:0">Current</h3>
          <article class="card">
            ${topicPreviewHTML(current, cslug, { showResearch:true, showDebate:true })}
          </article>
        </section>`
      : `
        <section>
          <h3 style="margin-top:0">Current</h3>
          <article class="card"><p class="muted">No current topic.</p></article>
        </section>`;

    // Previous cards (titles only, no previews if you prefer; here we keep concise previews off)
    const prevCards = previous.length
      ? previous.map(t => {
          const slug = t.slug || slugify(t.topic);
          // Use a lighter preview (no research/notes) to keep list compact
          return `<article class="card">${topicPreviewHTML(t, slug, { showResearch:false, showDebate:false })}</article>`;
        }).join('')
      : `<article class="card"><p class="muted">No previous topics yet.</p></article>`;

    document.getElementById('app').innerHTML = `
      <div class="wrap">
        <h2>Topics</h2>
        <div class="grid" style="grid-template-columns:1fr 1fr">
          ${currentSection}
          <section>
            <h3 style="margin-top:0">Previous</h3>
            <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap: var(--gap);">
              ${prevCards}
            </div>
          </section>
        </div>
      </div>`;
  }catch(e){ showError(e); }
}

async function renderTopicDetail(slug){
  try{
    const topics = await loadJSON('data/topics.json');
    const list = Array.isArray(topics) ? topics : [];
    const t = list.find(x => (x.slug || slugify(x.topic)) === slug);
    if(!t){ document.getElementById('app').innerHTML = '<div class="wrap">Topic not found.</div>'; return; }

    // ----- Optional Country Matrix CSV -----
    let matrixCard = '';
    const path = t.matrix_csv || `data/matrices/${slug}.csv`;
    try{
      const rows = await loadCSV(path);
      if(rows.length){
        const headers = Object.keys(rows[0]);
        matrixCard = `<article class="card">
          <h3>Country Matrix</h3>
          <div style="overflow:auto">
            <table class="table">
              <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
              <tbody>${rows.map(r => `<tr>${headers.map(h => `<td>${esc(r[h] || '')}</td>`).join('')}</tr>`).join('')}</tbody>
            </table>
          </div>
        </article>`;
      }
    }catch{/* optional */}

    // ----- Resources -----
    const resourcesCard = `<article class="card">
      <h3>Resources</h3>
      <div class="pills">${(t.resources || []).map(e => previewPill(e.name||e.label||e.url, e.url)).join('') || '<span class="pill">None</span>'}</div>
    </article>`;

    // ----- Research Links -----
    const researchItems = Array.isArray(t.research_links) ? t.research_links : [];
    const researchCard = researchItems.length ? `<article class="card">
      <h3>Research Links</h3>
      <div class="pills">${
        researchItems.map(item => {
          if (typeof item === 'string') return previewPill(normalizeLabelFromURL(item), item);
          return previewPill(item.name||item.label||normalizeLabelFromURL(item.url), item.url);
        }).join('')
      }</div>
    </article>` : '';

    // ----- Debate Notes -----
    const debate = Array.isArray(t.debate_notes) ? t.debate_notes : [];
    const debateCard = debate.length ? `<article class="card">
      <h3>Debate Notes</h3>
      <div class="pills">${
        debate.map(n => {
          if (typeof n === 'string') return `<span class="pill">${esc(n)}</span>`;
          if (n && n.url) return previewPill(n.label || normalizeLabelFromURL(n.url), n.url);
          return '';
        }).join('')
      }</div>
    </article>` : '';

    // ----- Resolutions (optional) -----
    const res = Array.isArray(t.resolution_links) ? t.resolution_links : [];
    const resolutionsCard = res.length ? `<article class="card">
      <h3>Resolutions</h3>
      <div class="pills">${res.map(r => previewPill(r.name||r.label||r.url, r.url)).join('')}</div>
    </article>` : '';

    // ----- Speaking Stats (optional) -----
    const stats = Array.isArray(t.speaking_stats) ? t.speaking_stats : [];
    const statsCard = stats.length ? `<article class="card">
      <h3>Speaking Stats</h3>
      <table class="table">
        <thead><tr><th>Country</th><th># Times Spoken</th></tr></thead>
        <tbody>${stats.map(s => `<tr><td>${esc(s.country)}</td><td>${esc(String(s.times_spoken))}</td></tr>`).join('')}</tbody>
      </table>
    </article>` : '';

    // ----- About -----
    const aboutCard = `<article class="card">
      <h3>About</h3>
      ${renderAboutHTML(t.description || t.about)}
    </article>`;

    // Build a single masonry container so cards can mix big/small and fill space
    document.getElementById('app').innerHTML = `<div class="wrap">
      <h2>${esc(t.topic || 'Untitled Topic')}</h2>
      <div class="masonry">
        ${aboutCard}
        ${resourcesCard}
        ${researchCard}
        ${debateCard}
        ${resolutionsCard}
        ${statsCard}
        ${matrixCard}
      </div>
    </div>`;
  }catch(e){ showError(e); }
}

async function renderBoard(){
  try{
    const board = await loadJSON('data/board.json');
    document.getElementById('app').innerHTML = `<div class="wrap">
      <h2>Board</h2>
      <table class="table">
        <thead><tr><th>Member</th><th>Role</th><th>Contact</th></tr></thead>
        <tbody>${
          board.map(b => `<tr>
            <td>${esc(b.name || '')}</td>
            <td>${esc(b.role || '')}</td>
            <td>${b.email ? `<a href="mailto:${b.email}">${esc(b.email)}</a>` : '—'}</td>
          </tr>`).join('')
        }</tbody>
      </table>
    </div>`;
  }catch(e){ showError(e); }
}

/* ===== ROUTER ===== */
function route(){
  const hash = location.hash || '#/';
  const topic = hash.match(/^#\/topic\/([^\s?#]+)/);
  if(topic){ renderTopicDetail(decodeURIComponent(topic[1])); return; }
  if(hash === '#/topics') return renderTopics();
  if(hash === '#/board') return renderBoard();
  return renderHome();
}
route();

/* ===== Konami confetti (unchanged) ===== */
function burst(){
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const DPR = devicePixelRatio || 1;
  let w = innerWidth * DPR, h = innerHeight * DPR;
  canvas.width = w; canvas.height = h;

  const colors = ['#1f6feb','#ff6b6b','#ffd166','#06d6a0','#c77dff','#ff9e00'];
  const parts = Array.from({length:180}, () => ({
    x: Math.random()*w, y: -20, r: 4+Math.random()*6,
    vx: -2+Math.random()*4, vy: 2+Math.random()*3, a: 1,
    color: colors[Math.floor(Math.random()*colors.length)]
  }));

  let t = 0, id;
  (function tick(){
    id = requestAnimationFrame(tick); t++; ctx.clearRect(0,0,w,h);
    parts.forEach(p=>{ p.x+=p.vx; p.y+=p.vy; p.vy+=0.03; p.a-=0.004;
      ctx.globalAlpha=Math.max(p.a,0); ctx.fillStyle=p.color;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
    });
    if(t>600){ cancelAnimationFrame(id); canvas.remove(); }
  })();
}
(function(){
  const seq = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  let i = 0;
  window.addEventListener('keydown', (e) => {
    const k = (e.key && e.key.length === 1) ? e.key.toLowerCase() : e.key;
    const want = seq[i];
    if (k === want) { i++; if (i === seq.length) { i = 0; burst(); } }
    else { i = (k === seq[0]) ? 1 : 0; }
  }, { passive: true });
})();