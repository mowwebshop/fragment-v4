const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { convertMany, DEFAULT_FRAGMENT, decodeSubscriptionContent } = require('./converter');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: 'text/plain', limit: '1mb' }));

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------
// Persistent storage for saved configs (survives restarts only if
// DATA_DIR points at a Railway Volume — see README notes)
// ---------------------------------------------------------------------
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

const SLUG_RE = /^[a-zA-Z0-9_-]{3,64}$/;

// Simple HTML form for manual/browser use
app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fragment — signal dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root{
    --bg: #0E1420;
    --panel: #141C2B;
    --panel-2: #101725;
    --line: #223049;
    --teal: #5EEAD4;
    --teal-dim: #2B6B62;
    --violet: #8B8FF7;
    --text: #E4E9F2;
    --text-dim: #7C8AA3;
  }
  *{ box-sizing:border-box; }
  body{
    margin:0; background: radial-gradient(1200px 500px at 15% -10%, #17233A 0%, var(--bg) 55%);
    color: var(--text); font-family:'Space Grotesk', sans-serif; min-height:100vh;
  }
  code, .mono, textarea, input{ font-family:'JetBrains Mono', ui-monospace, monospace; }

  .wrap{ max-width: 920px; margin:0 auto; padding: 56px 24px 90px; }

  .hero{ display:flex; align-items:flex-start; justify-content:space-between; gap: 30px; margin-bottom: 30px; }
  .hero .eyebrow{ color: var(--teal); font-size:12px; letter-spacing:0.18em; text-transform:uppercase; font-weight:600; }
  .hero h1{ margin:8px 0 0; font-size: 34px; font-weight:700; letter-spacing:-0.02em; }
  .hero p{ color: var(--text-dim); font-size:14px; margin-top:10px; max-width:52ch; line-height:1.6; }

  /* Signature: segmented waveform representing the two fragment stages (tlshello split + 1-1 split) */
  .waveform{ display:flex; flex-direction:column; gap:6px; min-width:210px; }
  .waveform .stage-label{ font-size:10px; color:var(--text-dim); letter-spacing:0.08em; text-transform:uppercase; }
  .waveform .bars{ display:flex; align-items:flex-end; gap:2px; height:44px; }
  .waveform .bar{ width:6px; background: linear-gradient(180deg, var(--teal), var(--teal-dim)); border-radius:2px 2px 0 0; }
  .waveform .bar.alt{ background: linear-gradient(180deg, var(--violet), #3F4173); }

  .grid{ display:grid; grid-template-columns: 1fr; gap: 22px; }

  .card{
    background: linear-gradient(180deg, var(--panel), var(--panel-2));
    border: 1px solid var(--line); border-radius: 14px; overflow:hidden;
    box-shadow: 0 20px 40px -30px rgba(0,0,0,0.6);
  }
  .card-head{
    display:flex; align-items:center; gap:12px; padding: 18px 22px; border-bottom:1px solid var(--line);
  }
  .idx{
    width:26px; height:26px; border-radius:8px; background: rgba(94,234,212,0.12); color: var(--teal);
    display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700;
  }
  .card-head h2{ margin:0; font-size:15px; font-weight:600; }
  .card-head .desc{ margin-left:auto; font-size:12px; color: var(--text-dim); }
  .card-body{ padding: 22px; }

  label{ display:block; font-size:11.5px; color: var(--text-dim); margin-bottom:7px; font-weight:500; }

  textarea, input[type=text]{
    width:100%; background: #0B111C; border:1px solid var(--line); color: var(--text);
    font-size: 12.5px; padding: 12px 14px; border-radius:10px; resize:vertical; line-height:1.55;
  }
  textarea:focus, input:focus{ outline:none; border-color: var(--teal-dim); box-shadow: 0 0 0 3px rgba(94,234,212,0.08); }
  textarea::placeholder, input::placeholder{ color:#4A5875; }

  .actions{ display:flex; gap:10px; margin-top:14px; flex-wrap:wrap; }

  button{
    font-family:'Space Grotesk', sans-serif; font-weight:600; font-size:13px;
    background: var(--teal); color:#08201B; border:none; padding:10px 18px; border-radius:9px; cursor:pointer;
    transition: transform 0.1s, opacity 0.1s;
  }
  button:hover{ opacity:0.88; transform: translateY(-1px); }
  button.secondary{ background: transparent; color: var(--text); border:1px solid var(--line); }
  button.secondary:hover{ background: rgba(255,255,255,0.04); }

  .subhead{ font-size:11px; color: var(--text-dim); text-transform:uppercase; letter-spacing:0.08em; margin: 22px 0 10px; }

  .modes{ display:flex; gap: 20px; }
  .modes label{ display:flex; align-items:center; gap:7px; color: var(--text); font-size:13px; cursor:pointer; margin:0; }
  .modes input{ accent-color: var(--teal); width:15px; height:15px; }

  .saved{
    margin-top:16px; padding:14px 16px; border-radius:10px; background: rgba(94,234,212,0.06);
    border:1px solid var(--teal-dim); display:none;
  }
  .saved .k{ font-size:11px; color: var(--teal); font-weight:600; letter-spacing:0.05em; }
  .saved .actions{ margin-top:10px; }
  .saved input{ flex:1; }
</style>
</head>
<body>
<div class="wrap">
  <div class="hero">
    <div>
      <div class="eyebrow">fragment injector</div>
      <h1>Signal Dashboard</h1>
      <p>Rewrite fp/fm on VLESS &amp; Trojan links, in bulk or straight from a subscription feed — then park the result behind one link that stays put.</p>
    </div>
    <div class="waveform" aria-hidden="true">
      <span class="stage-label">tlshello · 1-1</span>
      <div class="bars">
        <div class="bar" style="height:10%"></div>
        <div class="bar" style="height:70%"></div>
        <div class="bar" style="height:4%"></div>
        <div class="bar alt" style="height:2%"></div>
        <div class="bar alt" style="height:85%"></div>
        <div class="bar alt" style="height:6%"></div>
      </div>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <div class="card-head">
        <div class="idx">01</div>
        <h2>Manual</h2>
        <span class="desc">Paste configs directly</span>
      </div>
      <div class="card-body">
        <label>Configs — one per line</label>
        <textarea id="m-input" rows="7" placeholder="vless://...&#10;trojan://..."></textarea>
        <div class="actions"><button onclick="convertManual()">Convert</button></div>

        <div class="subhead">Output</div>
        <textarea id="m-output" rows="7" readonly></textarea>
        <div class="actions"><button class="secondary" onclick="copyText('m-output')">Copy</button></div>

        <div class="subhead">Save to a fixed link</div>
        <label>Slug</label>
        <input id="m-slug" type="text" placeholder="my-configs">
        <div class="actions modes" style="margin-top:12px;">
          <label><input type="radio" name="m-mode" value="rewrite" checked> Rewrite</label>
          <label><input type="radio" name="m-mode" value="append"> Append</label>
        </div>
        <div class="actions"><button onclick="saveOutput('m')">Save to URL</button></div>

        <div class="saved" id="m-saved-url">
          <span class="k">SAVED</span>
          <div class="actions">
            <input id="m-saved-url-input" type="text" readonly>
            <button class="secondary" onclick="copyText('m-saved-url-input')">Copy link</button>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="idx">02</div>
        <h2>Subscription Link</h2>
        <span class="desc">Fetch, decode, convert</span>
      </div>
      <div class="card-body">
        <label>Subscription URL</label>
        <input id="s-url" type="text" placeholder="https://.../subscribe/...">
        <div class="actions"><button onclick="convertSub()">Fetch &amp; Convert</button></div>

        <div class="subhead">Output</div>
        <textarea id="s-output" rows="7" readonly></textarea>
        <div class="actions"><button class="secondary" onclick="copyText('s-output')">Copy</button></div>

        <div class="subhead">Save to a fixed link</div>
        <label>Slug</label>
        <input id="s-slug" type="text" placeholder="my-sub">
        <div class="actions modes" style="margin-top:12px;">
          <label><input type="radio" name="s-mode" value="rewrite" checked> Rewrite</label>
          <label><input type="radio" name="s-mode" value="append"> Append</label>
        </div>
        <div class="actions"><button onclick="saveOutput('s')">Save to URL</button></div>

        <div class="saved" id="s-saved-url">
          <span class="k">SAVED</span>
          <div class="actions">
            <input id="s-saved-url-input" type="text" readonly>
            <button class="secondary" onclick="copyText('s-saved-url-input')">Copy link</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
  async function convertManual() {
    const input = document.getElementById('m-input').value;
    const res = await fetch('/convert', { method:'POST', headers:{'Content-Type':'text/plain'}, body: input });
    document.getElementById('m-output').value = await res.text();
  }
  async function convertSub() {
    const url = document.getElementById('s-url').value.trim();
    if (!url) { alert('Enter a subscription URL.'); return; }
    const res = await fetch('/convert-sub', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url }) });
    if (!res.ok) { const d = await res.json().catch(()=>({})); alert(d.error || 'Failed.'); return; }
    document.getElementById('s-output').value = await res.text();
  }
  function copyText(id) {
    const el = document.getElementById(id); el.select(); navigator.clipboard.writeText(el.value);
  }
  async function saveOutput(prefix) {
    const content = document.getElementById(prefix + '-output').value;
    const slug = document.getElementById(prefix + '-slug').value.trim();
    const mode = document.querySelector('input[name="' + prefix + '-mode"]:checked').value;
    if (!content.trim()) { alert('Convert something first.'); return; }
    const res = await fetch('/save', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ content, slug: slug || undefined, mode }) });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Save failed'); return; }
    document.getElementById(prefix + '-slug').value = data.slug;
    document.getElementById(prefix + '-saved-url-input').value = data.url;
    document.getElementById(prefix + '-saved-url').style.display = 'block';
  }
</script>
</body>
</html>`);
});

// POST /convert
// Accepts either:
//   - text/plain body: raw links, one per line
//   - application/json body: { "links": ["...", "..."], "fragment": {...} (optional) }
// Returns: text/plain, converted links one per line
app.post('/convert', (req, res) => {
  let links = [];
  let fragment = DEFAULT_FRAGMENT;

  if (req.is('application/json')) {
    const body = req.body || {};
    if (!Array.isArray(body.links)) {
      return res.status(400).json({ error: 'Expected JSON body: { "links": ["..."] }' });
    }
    links = body.links;
    if (body.fragment) fragment = body.fragment;
  } else {
    const raw = typeof req.body === 'string' ? req.body : '';
    links = raw.split('\n');
  }

  if (links.length === 0) {
    return res.status(400).send('No links provided');
  }

  const result = convertMany(links, fragment);

  if (req.is('application/json')) {
    return res.json({ links: result });
  }
  res.type('text/plain').send(result.join('\n'));
});

// POST /save
// Body (JSON): { content: "line1\nline2...", slug?: "my-configs" }
// If slug is omitted, a new random slug is generated.
// If slug is provided and already exists, its content is overwritten
// (rewritten) — the URL /raw/<slug> stays the same.
app.post('/save', (req, res) => {
  const body = req.is('application/json') ? req.body || {} : {};
  const content = typeof body.content === 'string' ? body.content : '';
  const mode = body.mode === 'append' ? 'append' : 'rewrite';
  let slug = typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim() : null;

  if (!content.trim()) {
    return res.status(400).json({ error: 'content is required' });
  }
  if (slug && !SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'slug must be 3-64 chars: letters, numbers, - or _' });
  }
  if (!slug) {
    slug = crypto.randomBytes(4).toString('hex');
  }

  const store = loadStore();
  if (mode === 'append' && store[slug] && store[slug].content) {
    store[slug] = {
      content: store[slug].content.replace(/\n+$/, '') + '\n' + content,
      updatedAt: new Date().toISOString()
    };
  } else {
    store[slug] = { content, updatedAt: new Date().toISOString() };
  }
  saveStore(store);

  const rawUrl = `${req.protocol}://${req.get('host')}/raw/${slug}`;
  res.json({ slug, url: rawUrl, mode });
});

// GET /raw/:slug -> plain text content, subscribable in a VPN client
app.get('/raw/:slug', (req, res) => {
  const store = loadStore();
  const entry = store[req.params.slug];
  if (!entry) return res.status(404).send('Not found');
  res.type('text/plain').send(entry.content);
});

// POST /convert-sub
// Body (JSON): { url: "https://.../sub-link", fragment?: {...} }
// Fetches the subscription URL server-side, decodes it (plain or base64),
// applies the fragment injection to every vless/trojan line, returns plain text.
app.post('/convert-sub', async (req, res) => {
  const body = req.is('application/json') ? req.body || {} : {};
  const subUrl = typeof body.url === 'string' ? body.url.trim() : '';
  const fragment = body.fragment || DEFAULT_FRAGMENT;

  if (!subUrl) {
    return res.status(400).json({ error: 'url is required' });
  }
  if (!/^https?:\/\//i.test(subUrl)) {
    return res.status(400).json({ error: 'url must start with http:// or https://' });
  }

  try {
    const upstream = await fetch(subUrl, { headers: { 'User-Agent': 'v2ray/config-converter' } });
    if (!upstream.ok) {
      return res.status(502).json({ error: `Upstream returned ${upstream.status}` });
    }
    const raw = await upstream.text();
    const decoded = decodeSubscriptionContent(raw);
    const lines = decoded.split('\n').map((l) => l.trim()).filter(Boolean);
    const result = convertMany(lines, fragment);
    res.type('text/plain').send(result.join('\n'));
  } catch (err) {
    res.status(502).json({ error: `Failed to fetch subscription link: ${err.message}` });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
