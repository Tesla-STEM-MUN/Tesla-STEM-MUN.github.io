/* ================= NAV ================= */
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


/* ================= HELPERS ================= */
function esc(s){ return (s||'').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

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
    `<div class="error"><strong>Data load failed</strong>\n${esc(e.message)}\n\nCheck that /data files exist, are valid, and you are serving over http:// (not file://). Then hard refresh (Ctrl/Cmd+Shift+R).</div>`;
  console.error(e);
}

function renderBanner(site){
  const root = document.getElementById('banner-root');
  const until = site.cancel_until ? usDateToISO(site.cancel_until) : null;
  const msg = site.cancel_all_upcoming ? 'All upcoming meetings are cancelled until further notice.'
            : (until ? `All meetings are cancelled through ${esc(site.cancel_until)}.` : '');
  root.innerHTML = (site.cancel_all_upcoming || until) ? `<div class="banner">${msg}</div>` : '';
}

function isCancelled(site, m){
  const dISO = usDateToISO(m.date);
  if(m.cancelled) return true;
  if(site.cancel_all_upcoming) return true;
  if(site.cancel_until && dISO <= usDateToISO(site.cancel_until)) return true;
  if(Array.isArray(site.cancel_dates) && site.cancel_dates.map(usDateToISO).includes(dISO)) return true;
  return false;
}

function renderAboutHTML(about) {
  if (Array.isArray(about)) return about.map(p => `<p>${esc(p)}</p>`).join('');
  if (typeof about !== 'string' || !about.trim()) return '<p class="muted">Add "description" in topics.json</p>';
  return about
    .split(/\n{2,}/)
    .map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function slugify(s){
  return (s||'')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/(^-|-$)/g,'') || 'topic';
}


/* ================= CSV PARSER ================= */
function parseCSV(text){
  const out = [];
  let row = [], field = '';
  let i = 0, q = false;

  while (i < text.length) {
    const c = text[i], n = text[i+1];
    if (q) {
      if (c === '"'){ if (n === '"'){ field += '"'; i+=2; continue; } q=false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"'){ q=true; i++; continue; }
    if (c === ','){ row.push(field); field=''; i++; continue; }
    if (c === '\n' || c === '\r'){
      if (field !== '' || row.length){ row.push(field); out.push(row); }
      row=[]; field='';
      if (c === '\r' && n === '\n') i+=2; else i+=1;
      continue;
    }
    field += c; i++;
  }
  if (field !== '' || row.length){ row.push(field); out.push(row); }
  if (!out.length) return [];
  const headers = out[0].map(h => h.trim());
  return out.slice(1).filter(r => r.length).map(r => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] || '').trim(); });
    return obj;
  });
}


/* ================= LOADERS ================= */
async function loadJSON(path){
  const r = await fetch(path, {cache:'no-store'});
  if(!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  try { return await r.json(); } catch { throw new Error(`${path} → invalid JSON`); }
}

async function loadCSV(path){
  const r = await fetch(path, {cache:'no-store'});
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
  } catch (csvErr) {
    try {
      const js = await loadJSON('data/meetings.json');
      return (js || []).map(m => ({
        date: m.date || m.day || '',
        time: (m.time || '').trim(),
        duration: (m.duration || '').trim(),
        type: m.type || m.kind || '',
        room: m.room || m.place || m.location || '',
        cancelled: !!m.cancelled
      }));
    } catch (jsonErr) {
      throw new Error(`meetings.csv & meetings.json both failed:\n - ${csvErr.message}\n - ${jsonErr.message}`);
    }
  }
}


/* ================= SHARED TOPIC PREVIEW ================= */
/**
 * Renders a compact topic preview with:
 * - Resources (blue link pills)
 * - Optional Research Links preview (2 pills + "See all")
 * - Optional Debate Notes preview (2 pills, links first + "+N more")
 */
function topicPreviewHTML(t, slug, { showResearch = true, showDebate = true } = {}){
  const escOr = (s,f)=> s ? esc(s) : f;

  // resources → blue pills
  const resHTML = (t.resources || [])
    .map(e => `<a class="pill link" href="${e.url}" target="_blank" rel="noopener">${escOr(e.name||e.label||'Link','Link')} →</a>`)
    .join(' ') || '<span class="pill">No resources</span>';

  // research (preview 2) → blue pills + See all
  let researchBlock = '';
  if (showResearch) {
    const rl = Array.isArray(t.research_links) ? t.research_links : [];
    const prev = rl.slice(0,2).map(item=>{
      const url = typeof item === 'string' ? item : item.url;
      const label = typeof item === 'string'
        ? url.replace(/^https?:\/\/(www\.)?/,'').replace(/\/$/,'')
        : (item.name || item.label || item.url);
      return `<a class="pill link" href="${url}" target="_blank" rel="noopener">${esc(label)} →</a>`;
    }).join(' ');
    researchBlock = rl.length
      ? `<div class="muted" style="margin-top:10px;">Research Links:</div>
         <div>${prev || '<span class="pill">None</span>'}</div>
         <div style="margin-top:6px;"><a href="#/topic/${encodeURIComponent(slug)}">${rl.length>2?'See all →':'All research links →'}</a></div>`
      : `<div class="muted" style="margin-top:10px;">Research Links:</div><div class="muted">None</div>`;
  }

  // debate (preview 2) → link pills first, gray text pills second + “+N more”
  let debateBlock = '';
  if (showDebate) {
    const debate = Array.isArray(t.debate_notes) ? t.debate_notes : [];
    const text = debate.filter(n => typeof n === 'string' && n.trim());
    const links = debate.filter(n => n && typeof n === 'object' && n.url);
    const pick = [
      ...links.slice(0,2),
      ...text.slice(0, Math.max(0, 2 - Math.min(2, links.length)))
    ];
    const pills = pick.map(n=>{
      if (typeof n === 'string') return `<span class="pill">${esc(n)}</span>`;
      const url = n.url;
      const label = (n.label && n.label.trim())
        || (url.split('/').pop()||'').split('?')[0]
        || url.replace(/^https?:\/\/(www\.)?/,'').replace(/\/$/,'');
      return `<a class="pill link" href="${url}" target="_blank" rel="noopener">${esc(label)} →</a>`;
    }).join(' ');
    const remain = Math.max(0, debate.length - pick.length);
    debateBlock = debate.length
      ? `<div class="muted" style="margin-top:10px;">Debate Notes:</div>
         <div>${pills || '<span class="pill">None</span>'}</div>
         <div style="margin-top:6px;"><a href="#/topic/${encodeURIComponent(slug)}">${remain>0?`+${remain} more →`:'All notes →'}</a></div>`
      : `<div class="muted" style="margin-top:10px;">Debate Notes:</div><div class="muted">None</div>`;
  }

  return `
    <div><strong>${escOr(t.topic,'Untitled Topic')}</strong></div>
    <div class="muted" style="margin-top:10px;">Resources:</div>
    <div>${resHTML}</div>
    ${researchBlock}
    ${debateBlock}
  `;
}


/* ================= PAGES ================= */
async function renderHome(){
  try{
    const [site, meetings, topics] = await Promise.all([
      loadJSON('data/site.json'),
      loadMeetings(),
      loadJSON('data/topics.json')
    ]);
    renderBanner(site);

    // next non-cancelled meeting at/after now
    const upcoming = meetings
      .filter(m => !isCancelled(site, m) && buildDateTime(m.date, m.time) >= new Date())
      .sort((a,b) => buildDateTime(a.date,a.time) - buildDateTime(b.date,b.time))[0];

    const next = upcoming ? `
      <div class="hero">
        <h2>Next Meeting <span class="pill ok">${esc(upcoming.type)}</span></h2>
        <div class="muted">
          ${buildDateTime(upcoming.date,upcoming.time).toLocaleString([], {
            weekday:'long', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit'
          })}${upcoming.duration ? ` · Duration: <strong>${esc(upcoming.duration)}</strong>` : ''}
        </div>
        <div class="muted">Room: <strong>${esc(upcoming.room)}</strong></div>
      </div>`
      : `<div class="hero"><h2>No upcoming meeting found</h2><div class="muted">Add one in <code>data/meetings.csv</code> or <code>data/meetings.json</code>.</div></div>`;

    const topicsList = Array.isArray(topics) ? topics : [];
    const current = topicsList[0] || null;
    const currentSlug = current ? (current.slug || slugify(current.topic)) : null;

    document.getElementById('app').innerHTML = `${next}
      <div class="grid">
        <article class="card">
          <h3>Current Topic</h3>
          ${
            current
              ? topicPreviewHTML(current, currentSlug, { showResearch:true, showDebate:true })
              : '<p class="muted">No topics yet.</p>'
          }
        </article>

        <article class="card">
          <h3>Resources</h3>
          <div>${(site.resources || []).map(r =>
            `<div><a href="${r.url}" target="_blank" rel="noopener">${esc(r.label || r.name || r.url)}</a></div>`).join('')}
          </div>
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

    const currentSlug = current ? (current.slug || slugify(current.topic)) : null;

    const currentCard = current ? `
      <article class="card">
        <h3>Current</h3>
        ${topicPreviewHTML(current, currentSlug, { showResearch:true, showDebate:true })}
        <p style="margin-top:8px;"><a href="#/topic/${encodeURIComponent(currentSlug)}">Open topic page →</a></p>
      </article>` :
      `<article class="card"><h3>Current</h3><p class="muted">No current topic.</p></article>`;

    const prevCards = previous.length
      ? previous.map(t => {
          const slug = t.slug || slugify(t.topic);
          return `
            <article class="card">
              ${topicPreviewHTML(t, slug, { showResearch:false, showDebate:false })}
              <p style="margin-top:8px;"><a href="#/topic/${encodeURIComponent(slug)}">Open topic page →</a></p>
            </article>`;
        }).join('')
      : `<article class="card"><p class="muted">No previous topics yet.</p></article>`;

    document.getElementById('app').innerHTML = `
      <div class="wrap"><h2>Topics</h2>
        <div class="grid" style="grid-template-columns:1fr 1fr">
          ${currentCard}
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

    // Optional embedded Country Matrix CSV
    let matrixHTML = '';
    const path = t.matrix_csv || `data/matrices/${slug}.csv`;
    try{
      const rows = await loadCSV(path);
      if(rows.length){
        const headers = Object.keys(rows[0]);
        matrixHTML = `<div class="card"><h3>Country Matrix</h3>
          <div style="overflow:auto">
            <table class="table">
              <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
              <tbody>${rows.map(r => `<tr>${headers.map(h => `<td>${esc(r[h] || '')}</td>`).join('')}</tr>`).join('')}</tbody>
            </table>
          </div>
        </div>`;
      }
    }catch{ /* matrix is optional */ }

    // Resources (detail page list)
    const resourcesHTML = `<article class="card">
      <h3>Resources</h3>
      <ul>${(t.resources || []).map(e => `<li><a href="${e.url}" target="_blank" rel="noopener">${esc(e.name || e.label || e.url)}</a></li>`).join('') || '<li class="muted">No resources</li>'}</ul>
    </article>`;

    // Research Links
    const researchItems = Array.isArray(t.research_links) ? t.research_links : [];
    const researchHTML = researchItems.length
      ? `<article class="card">
           <h3>Research Links</h3>
           <ul>${
              researchItems.map(item => {
                if (typeof item === 'string') {
                  const label = item.replace(/^https?:\/\/(www\.)?/,'').replace(/\/$/,'');
                  return `<li><a href="${item}" target="_blank" rel="noopener">${esc(label)}</a></li>`;
                }
                return `<li><a href="${item.url}" target="_blank" rel="noopener">${esc(item.name || item.label || item.url)}</a></li>`;
              }).join('')
            }</ul>
         </article>`
      : '';

    // Debate Notes
    const debate = Array.isArray(t.debate_notes) ? t.debate_notes : [];
    const debateHTML = debate.length
      ? `<article class="card">
           <h3>Debate Notes</h3>
           <ul>${
             debate.map(n => {
               if (typeof n === 'string') return `<li>${esc(n)}</li>`;
               if (n && n.url) return `<li><a href="${n.url}" target="_blank" rel="noopener">${esc(n.label || n.url)}</a></li>`;
               return '';
             }).join('')
           }</ul>
         </article>`
      : '';

    // Resolutions (optional)
    const res = Array.isArray(t.resolution_links) ? t.resolution_links : [];
    const resHTML = res.length
      ? `<article class="card">
           <h3>Resolutions</h3>
           <ul>${res.map(r => `<li><a href="${r.url}" target="_blank" rel="noopener">${esc(r.name || r.label || r.url)}</a></li>`).join('')}</ul>
         </article>`
      : '';

    // Layout
    document.getElementById('app').innerHTML = `<div class="wrap">
      <h2>${esc(t.topic || 'Untitled Topic')}</h2>
      <div class="grid-topic">
        <article class="card col-about">
          <h3>About</h3>
          ${renderAboutHTML(t.description)}
        </article>

        <div class="col-middle">
          ${resourcesHTML}
          ${researchHTML}
          ${debateHTML}
          ${resHTML}
        </div>

        ${matrixHTML ? `<div class="col-matrix">${matrixHTML}</div>` : ''}
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


/* ================= ROUTER ================= */
function route(){
  const hash = location.hash || '#/';
  const topic = hash.match(/^#\/topic\/([^\s?#]+)/);
  if(topic){ renderTopicDetail(decodeURIComponent(topic[1])); return; }
  if(hash === '#/topics') return renderTopics();
  if(hash === '#/board') return renderBoard();
  return renderHome();
}
route();


/* ================= KONAMI CONFETTI ================= */
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
    x: Math.random()*w,
    y: -20,
    r: 4+Math.random()*6,
    vx: -2+Math.random()*4,
    vy: 2+Math.random()*3,
    a: 1,
    color: colors[Math.floor(Math.random()*colors.length)]
  }));

  let t = 0, id;
  (function tick(){
    id = requestAnimationFrame(tick);
    t++;
    ctx.clearRect(0,0,w,h);
    parts.forEach(p=>{
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.03;
      p.a -= 0.004;
      ctx.globalAlpha = Math.max(p.a,0);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fill();
    });
    if(t>600){
      cancelAnimationFrame(id);
      canvas.remove();
    }
  })();
}
(function(){
  const seq = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  let i = 0;
  window.addEventListener('keydown', (e) => {
    const k = (e.key && e.key.length === 1) ? e.key.toLowerCase() : e.key;
    const want = seq[i];
    if (k === want) {
      i++;
      if (i === seq.length) { i = 0; burst(); }
    } else {
      i = (k === seq[0]) ? 1 : 0;
    }
  }, { passive: true });
})();