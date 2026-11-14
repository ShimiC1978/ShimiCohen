/* Hidden admin tool for the Hardware Wisdom Library.
   Loaded only after a triple-click on "© 2026" (desktop mouse). Writes to GitHub via the Contents API. */
(function () {
  if (window.openAdmin) { window.openAdmin(); return; }

  const OWNER = 'ShimiC1978', REPO = 'ShimiCohen', BRANCH = 'main';
  const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
  const KEY = 'hwl_admin_token';
  const LABELS = (typeof categoryLabels !== 'undefined') ? categoryLabels : {
    digital: 'Digital', analog: 'Analog', pcb: 'PCB Design', components: 'Components',
    systems: 'Systems', series20: '20-Series', tutorials: 'Tools & Sim'
  };
  const CATS = Object.keys(LABELS).filter(k => k !== 'all');

  const store = {
    get() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} },
    clear() { try { localStorage.removeItem(KEY); } catch (e) {} }
  };
  let token = store.get();
  let root = null, view = 'add', editing = null, busy = false;

  /* ---------- GitHub helpers ---------- */
  async function gh(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts, cache: 'no-store',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {})
      }
    });
    return res;
  }
  const enc = p => p.split('/').map(encodeURIComponent).join('/');
  const utf8b64 = s => btoa(unescape(encodeURIComponent(s)));
  const b64utf8 = s => decodeURIComponent(escape(atob(s.replace(/\n/g, ''))));
  async function blobB64(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = ''; const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
    return btoa(bin);
  }
  function explain(res, what) {
    if (res.status === 401) return `${what}: token is invalid or expired. Use "Forget token" and paste a new one.`;
    if (res.status === 403) return `${what}: GitHub refused (token missing "Contents: Read and write", or rate limit).`;
    if (res.status === 404) return `${what}: not found (check the token has access to ${OWNER}/${REPO}).`;
    if (res.status === 409 || res.status === 422) return `${what}: conflict, someone changed the file. Try again.`;
    return `${what}: GitHub error ${res.status}.`;
  }
  async function testToken() {
    const res = await gh('');
    if (!res.ok) throw new Error(explain(res, 'Token test'));
    const info = await res.json();
    if (!info.permissions || !info.permissions.push) throw new Error('Token can read but not write. Set "Contents: Read and write".');
    return true;
  }
  async function getBooks() {
    const res = await gh(`/contents/books.json?ref=${BRANCH}`);
    if (!res.ok) throw new Error(explain(res, 'Loading books.json'));
    const f = await res.json();
    return { sha: f.sha, data: JSON.parse(b64utf8(f.content)) };
  }
  function fmt(data) {
    return '{\n' + Object.entries(data).map(([k, v]) =>
      `  "${k}": [\n` + v.map(b => '    ' + JSON.stringify(b)).join(',\n') + '\n  ]').join(',\n') + '\n}\n';
  }
  async function putFile(path, contentB64, message, sha) {
    const body = { message, content: contentB64, branch: BRANCH };
    if (sha) body.sha = sha;
    const res = await gh('/contents/' + enc(path), { method: 'PUT', body: JSON.stringify(body) });
    if (!res.ok) throw new Error(explain(res, `Saving ${path}`));
    return res.json();
  }
  async function fileSha(path) {
    const res = await gh(`/contents/${enc(path)}?ref=${BRANCH}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(explain(res, `Checking ${path}`));
    return (await res.json()).sha;
  }
  async function deleteFile(path, message) {
    const sha = await fileSha(path);
    if (!sha) return;
    const res = await gh('/contents/' + enc(path), { method: 'DELETE', body: JSON.stringify({ message, sha, branch: BRANCH }) });
    if (!res.ok) throw new Error(explain(res, `Deleting ${path}`));
  }
  // Update books.json safely: re-read, apply change, write; retry once on conflict.
  async function updateBooks(mutator, message) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { sha, data } = await getBooks();
      mutator(data);
      JSON.parse(fmt(data)); // sanity check
      try { await putFile('books.json', utf8b64(fmt(data)), message, sha); return; }
      catch (e) { if (attempt === 1 || !/conflict/.test(e.message)) throw e; }
    }
  }

  /* ---------- helpers ---------- */
  async function toJpeg(file, maxW = 700) {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, maxW / bmp.width);
    const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.drawImage(bmp, 0, 0, w, h);
    return new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
  }
  const cleanName = s => s.replace(/[\\/:*?"<>|#%]/g, '').replace(/\s+/g, ' ').trim();
  const idOf = link => { const m = /(?:activity|ugcPost|share)[-:](\d+)/.exec(link || ''); return m ? m[1] : null; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const today = () => new Date().toISOString().slice(0, 10);

  /* ---------- UI ---------- */
  const CSS = `
  #hwlAdmin{position:fixed;inset:0;z-index:5000;background:rgba(5,5,5,.88);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;padding:4vh 16px;overflow:auto;font-family:Inter,Arial,sans-serif}
  #hwlAdmin .box{width:100%;max-width:640px;background:#050505;border:1px solid rgba(255,255,255,.16);border-radius:16px;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,.8);color:#fff}
  #hwlAdmin .hd{background:#ffb52e;color:#050505;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;font:700 1.15rem "Space Grotesk",sans-serif}
  #hwlAdmin .hd button{background:none;border:0;font-size:1.6rem;line-height:1;cursor:pointer;color:#050505;font-weight:700}
  #hwlAdmin .tabs{display:flex;border-bottom:1px solid rgba(255,255,255,.16)}
  #hwlAdmin .tabs button{flex:1;padding:12px;background:none;border:0;color:rgba(255,255,255,.72);font-weight:700;cursor:pointer;border-bottom:3px solid transparent}
  #hwlAdmin .tabs button.on{color:#ffb52e;border-bottom-color:#ffb52e}
  #hwlAdmin .bd{padding:20px}
  #hwlAdmin label{display:block;font-size:.78rem;font-weight:700;color:rgba(255,255,255,.72);margin:12px 0 5px;text-transform:uppercase;letter-spacing:.6px}
  #hwlAdmin input[type=text],#hwlAdmin input[type=password],#hwlAdmin select{width:100%;min-height:44px;border:1px solid rgba(255,255,255,.16);border-radius:8px;background:rgba(255,255,255,.055);color:#fff;padding:0 12px;font:inherit}
  #hwlAdmin input:focus,#hwlAdmin select:focus{outline:none;border-color:#ffb52e}
  #hwlAdmin select option{color:#000}
  #hwlAdmin .btn{min-height:44px;padding:0 20px;border:0;border-radius:8px;background:#ffb52e;color:#050505;font-weight:800;cursor:pointer;margin-top:16px}
  #hwlAdmin .btn.ghost{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.3)}
  #hwlAdmin .btn.sm{min-height:32px;padding:0 12px;margin:0 0 0 6px;font-size:.78rem}
  #hwlAdmin .btn.red{background:#d33;color:#fff}
  #hwlAdmin .btn[disabled]{opacity:.5;cursor:wait}
  #hwlAdmin .msg{margin-top:14px;padding:10px 12px;border-radius:8px;font-size:.88rem;line-height:1.4}
  #hwlAdmin .msg.err{background:rgba(220,50,50,.15);border:1px solid #d33;color:#ffb3b3}
  #hwlAdmin .msg.ok{background:rgba(40,180,90,.14);border:1px solid #2b6;color:#aef2c6}
  #hwlAdmin .msg.info{background:rgba(255,181,46,.12);border:1px solid rgba(255,181,46,.4);color:#ffd88a}
  #hwlAdmin ol{padding-left:20px;color:rgba(255,255,255,.8);font-size:.88rem;line-height:1.6}
  #hwlAdmin .row{display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:.88rem}
  #hwlAdmin .row .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #hwlAdmin .cat{margin:16px 0 4px;color:#ffb52e;font-weight:800;font-size:.8rem;text-transform:uppercase;letter-spacing:1px}
  #hwlAdmin .prev{margin-top:8px;max-width:140px;max-height:175px;border:1px solid rgba(255,255,255,.16);border-radius:8px;display:block}
  #hwlAdmin .chk{display:flex;gap:8px;align-items:center;margin-top:12px;font-size:.85rem;color:rgba(255,255,255,.8);text-transform:none;letter-spacing:0;font-weight:500}
  #hwlAdmin .foot{display:flex;justify-content:space-between;padding:12px 20px;border-top:1px solid rgba(255,255,255,.16);font-size:.78rem;color:rgba(255,255,255,.5)}
  #hwlAdmin .foot a{color:#ffb52e;cursor:pointer}
  `;

  function close() { if (root) { root.remove(); root = null; document.removeEventListener('keydown', onKey); } }
  function onKey(e) { if (e.key === 'Escape') close(); }
  function msg(kind, text) { const m = root.querySelector('#hwlMsg'); if (m) m.innerHTML = text ? `<div class="msg ${kind}">${esc(text)}</div>` : ''; }
  function setBusy(b) { busy = b; root.querySelectorAll('button.btn').forEach(x => x.disabled = b); }

  function shell(inner) {
    root.innerHTML = `<div class="box" role="dialog" aria-label="Admin">
      <div class="hd"><span>Library Admin</span><button id="hwlX" aria-label="Close">&times;</button></div>
      ${token ? `<div class="tabs"><button data-v="add" class="${view === 'add' ? 'on' : ''}">${editing ? 'Edit book' : 'Add book'}</button><button data-v="manage" class="${view === 'manage' ? 'on' : ''}">Manage</button></div>` : ''}
      <div class="bd">${inner}<div id="hwlMsg"></div></div>
      ${token ? `<div class="foot"><span>${OWNER}/${REPO} · ${BRANCH}</span><a id="hwlForget">Forget token</a></div>` : ''}
    </div>`;
    root.querySelector('#hwlX').onclick = close;
    root.onclick = e => { if (e.target === root) close(); };
    root.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { if (busy) return; if (b.dataset.v === 'add') editing = null; view = b.dataset.v; render(); });
    const f = root.querySelector('#hwlForget'); if (f) f.onclick = () => { store.clear(); token = ''; render(); };
  }

  function render() {
    if (!token) return renderSetup();
    if (view === 'manage') return renderManage();
    return renderForm();
  }

  function renderSetup() {
    shell(`<p style="margin:0 0 10px;color:rgba(255,255,255,.8);font-size:.9rem">One-time setup on this computer. Create a GitHub token:</p>
      <ol>
        <li>GitHub → Settings → Developer settings → Personal access tokens → Fine-grained → Generate new token</li>
        <li>Expiration: 1 year. Repository access: only <b>${OWNER}/${REPO}</b></li>
        <li>Permissions → Repository → <b>Contents: Read and write</b></li>
        <li>Generate, copy the token (shown once), paste below</li>
      </ol>
      <label for="hwlTok">Token</label><input type="password" id="hwlTok" placeholder="github_pat_..." autocomplete="off">
      <button class="btn" id="hwlSave">Save &amp; test</button>`);
    root.querySelector('#hwlSave').onclick = async () => {
      const v = root.querySelector('#hwlTok').value.trim();
      if (!v) return msg('err', 'Paste the token first.');
      token = v; setBusy(true); msg('info', 'Testing token...');
      try { await testToken(); store.set(v); view = 'add'; render(); }
      catch (e) { token = ''; setBusy(false); msg('err', e.message); }
    };
  }

  function renderForm() {
    const e = editing;
    const b = e ? e.book : {};
    shell(`
      <label for="aCat">Category</label>
      <select id="aCat">${CATS.map(c => `<option value="${c}" ${(e ? e.cat : 'digital') === c ? 'selected' : ''}>${esc(LABELS[c])}</option>`).join('')}</select>
      <label for="aTitle">Title</label><input type="text" id="aTitle" value="${esc(b.title)}">
      <label for="aLink">LinkedIn post URL</label><input type="text" id="aLink" value="${esc(b.link)}" placeholder="https://www.linkedin.com/posts/...">
      <label for="aReact">Reactions (optional, e.g. 1.2k)</label><input type="text" id="aReact" value="${esc(b.reactions)}">
      <label for="aTags">Tags (optional, comma separated)</label><input type="text" id="aTags" value="${esc((b.tags || []).join(', '))}">
      <label for="aFile">Cover image ${e ? '(optional, replaces current)' : ''}</label><input type="file" id="aFile" accept="image/*" style="color:#fff">
      <img id="aPrev" class="prev" alt="" style="display:none">
      <label for="aName">Cover file name</label><input type="text" id="aName" value="${esc(b.cover)}" ${e ? 'readonly' : ''}>
      ${e ? '' : '<label class="chk"><input type="checkbox" id="aFirst"> Show first in its category</label>'}
      <label class="chk" id="aForceW" style="display:none"><input type="checkbox" id="aForce"> <span id="aForceT"></span></label>
      <button class="btn" id="aGo">${e ? 'Save changes' : 'Add book'}</button>
      ${e ? '<button class="btn ghost" id="aCancel" style="margin-left:8px">Cancel</button>' : ''}`);
    let blob = null;
    const $ = id => root.querySelector('#' + id);
    $('aFile').onchange = async () => {
      const f = $('aFile').files[0]; blob = null; $('aPrev').style.display = 'none';
      if (!f) return;
      try {
        blob = await toJpeg(f);
        $('aPrev').src = URL.createObjectURL(blob); $('aPrev').style.display = 'block';
        if (!e && !$('aName').value) $('aName').value = cleanName(($('aTitle').value || f.name.replace(/\.[^.]+$/, '')) + ' Cover') + '.jpg';
        msg('info', `Cover resized to ${(blob.size / 1024).toFixed(0)}KB.`);
      } catch (x) { msg('err', 'Could not read that image.'); }
    };
    $('aTitle').oninput = () => { if (!e && !$('aFile').files[0]) return; };
    if ($('aCancel')) $('aCancel').onclick = () => { editing = null; view = 'manage'; render(); };
    $('aGo').onclick = async () => {
      const cat = $('aCat').value, title = $('aTitle').value.trim(), link = $('aLink').value.trim();
      const reactions = $('aReact').value.trim();
      const tags = $('aTags').value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      let cover = e ? b.cover : cleanName($('aName').value);
      if (!title) return msg('err', 'Title is required.');
      if (!/^https:\/\/(www\.)?linkedin\.com\//.test(link)) return msg('err', 'Link must be a https://www.linkedin.com/... URL.');
      const id = idOf(link);
      const problem = !id ? 'Could not find the post ID in this link.' : (id.length !== 19 ? `Post ID has ${id.length} digits, LinkedIn IDs have 19 (a digit may be missing).` : '');
      if (problem && !$('aForce').checked) {
        $('aForceW').style.display = 'flex'; $('aForceT').textContent = problem + ' Tick to use it anyway.';
        return msg('err', problem);
      }
      if (!e) {
        if (!blob) return msg('err', 'Choose a cover image.');
        if (!cover) return msg('err', 'Cover file name is required.');
        if (!/\.jpe?g$/i.test(cover)) cover += '.jpg';
      }
      setBusy(true); msg('info', 'Saving to GitHub...');
      try {
        if (!e) {
          if (await fileSha(cover)) throw new Error(`A file named "${cover}" already exists. Change the cover file name.`);
          await putFile(cover, await blobB64(blob), `Add cover: ${cover}`);
        } else if (blob) {
          await putFile(cover, await blobB64(blob), `Replace cover: ${cover}`, await fileSha(cover));
        }
        await updateBooks(data => {
          const entry = { title, link, cover };
          if (reactions) entry.reactions = reactions;
          if (tags.length) entry.tags = tags;
          entry.date = (e && b.date) || today();
          if (!data[cat]) data[cat] = [];
          if (e) {
            const list = data[e.cat] || [];
            const i = list.findIndex(x => x.title === e.book.title && x.cover === e.book.cover);
            if (i < 0) throw new Error('That book no longer exists in books.json.');
            if (e.cat === cat) list[i] = entry; else { list.splice(i, 1); data[cat].push(entry); }
          } else {
            if (data[cat].some(x => x.title.toLowerCase() === title.toLowerCase())) throw new Error(`"${title}" already exists in ${LABELS[cat]}.`);
            if ($('aFirst') && $('aFirst').checked) data[cat].unshift(entry); else data[cat].push(entry);
          }
        }, `${e ? 'Edit' : 'Add'} book: ${title}`);
        setBusy(false);
        const wasEdit = !!e; editing = null;
        if (wasEdit) { view = 'manage'; await renderManage(); }
        else { renderForm(); }
        msg('ok', `${wasEdit ? 'Saved' : 'Added'} "${title}". Live in about a minute (hard refresh the site).`);
      } catch (x) { setBusy(false); msg('err', x.message); }
    };
  }

  async function renderManage() {
    shell('<p style="color:rgba(255,255,255,.72)">Loading...</p>');
    let data;
    try { data = (await getBooks()).data; } catch (x) { return msg('err', x.message); }
    let html = '';
    Object.entries(data).forEach(([cat, list]) => {
      html += `<div class="cat">${esc(LABELS[cat] || cat)} (${list.length})</div>`;
      list.forEach((bk, i) => {
        html += `<div class="row"><span class="t" title="${esc(bk.title)}">${esc(bk.title)}${bk.reactions ? ` <span style="color:#ffb52e">· ${esc(bk.reactions)}</span>` : ''}</span>
          <button class="btn sm ghost" data-a="edit" data-c="${esc(cat)}" data-i="${i}">Edit</button>
          <button class="btn sm red" data-a="del" data-c="${esc(cat)}" data-i="${i}">Delete</button></div>`;
      });
    });
    shell(html);
    root.querySelectorAll('button[data-a]').forEach(btn => {
      btn.onclick = async () => {
        if (busy) return;
        const cat = btn.dataset.c, i = +btn.dataset.i, bk = data[cat][i];
        if (btn.dataset.a === 'edit') { editing = { cat, book: bk }; view = 'add'; return render(); }
        if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = 'Confirm?'; setTimeout(() => { btn.dataset.armed = ''; btn.textContent = 'Delete'; }, 4000); return; }
        setBusy(true); msg('info', 'Deleting...');
        try {
          await updateBooks(d => {
            const list = d[cat] || [], j = list.findIndex(x => x.title === bk.title && x.cover === bk.cover);
            if (j >= 0) list.splice(j, 1);
          }, `Delete book: ${bk.title}`);
          setBusy(false); await renderManage();
          msg('ok', `Deleted "${bk.title}" from the list (the cover file stays in the repo). Live in about a minute.`);
        } catch (x) { setBusy(false); msg('err', x.message); }
      };
    });
  }

  window.openAdmin = function () {
    if (root) return;
    if (!document.getElementById('hwlAdminCss')) {
      const s = document.createElement('style'); s.id = 'hwlAdminCss'; s.textContent = CSS; document.head.appendChild(s);
    }
    root = document.createElement('div'); root.id = 'hwlAdmin'; document.body.appendChild(root);
    document.addEventListener('keydown', onKey);
    view = 'add'; editing = null;
    render();
  };
  window.openAdmin();
})();
