/* ===========================================================
   app.js —— 译所 · 文献翻译工作台
   屏幕切换 / 拖拽上传 / 语言检测 / 翻译流程 / 名词注释
   =========================================================== */

(function () {
  'use strict';

  const KB = window.KB;
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* 最近一次译文结果，供「导出」使用 */
  let lastResult = null;

  /* ---------------- 工具 ---------------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  const now = () => {
    const d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((n) => String(n).padStart(2, '0')).join(':');
  };

  const TERM_MAP = {};
  KB.terms.forEach((t) => { TERM_MAP[t.name] = t; });

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-show'), 2200);
  }

  /* ---------------- 屏幕 / 视图切换 ---------------- */
  function showScreen(name) {
    if (name === 'terms') {
      showScreen('kb');
      setTimeout(() => $('#termPanel').scrollIntoView({ behavior:'smooth', block:'start' }), 60);
      syncNav('terms');
      return;
    }
    if (name === 'history' || name === 'settings') {
      toast('「' + (name === 'history' ? '历史' : '设置') + '」模块将在后续版本开放');
      return;
    }
    $('#screen-work').classList.toggle('is-hidden', name !== 'work');
    $('#screen-kb').classList.toggle('is-hidden', name !== 'kb');
    syncNav(name);
    if (name === 'kb') $('#screen-kb').scrollIntoView({ behavior:'auto', block:'start' });
  }

  function syncNav(name) {
    $$('.nav-item').forEach((b) => b.classList.toggle('is-active', b.dataset.screen === name));
    $$('.tab').forEach((b) => b.classList.toggle('is-active', b.dataset.screen === name));
  }

  function showView(name) {
    ['empty','running','result'].forEach((v) =>
      $('#view-' + v).classList.toggle('is-hidden', v !== name));
  }

  $$('.nav-item, .tab').forEach((b) =>
    b.addEventListener('click', () => showScreen(b.dataset.screen)));

  /* ---------------- 渲染：侧栏同步卡 ---------------- */
  function renderSync() {
    $('#syncStat').textContent = KB.sync.principleCount + ' 条译法原则 · ' + KB.sync.termCount + ' 条术语';
    $('#syncTime').textContent = '今日 ' + KB.sync.time + ' 更新';
    $('#syncClock').textContent = KB.sync.time;
    $('#runKbStat').textContent = KB.sync.principleCount + ' 条原则 · ' + KB.sync.termCount + ' 条术语';
    $('#hitPrinciples').textContent = KB.sync.principleCount + ' 条';
    $('#hitTerms').textContent = KB.sync.termCount + ' 条';
    $('#hitTags').innerHTML = KB.principles.slice(0, 3).map((p) =>
      '<span class="tag">' + esc(p.short || p.name) + '</span>').join('');
  }

  /* ---------------- 渲染：最近任务 / 队列 ---------------- */
  const STATE_MAP = {
    done:     { cls:'pill-green',  ico:'✅', text:'已完成' },
    running:  { cls:'pill-amber',  ico:'⏳', text:'翻译中' },
    queue:    { cls:'pill-soft',   ico:'💤', text:'排队中' },
    error:    { cls:'pill-gray',   ico:'⚠️', text:'失败' }
  };

  /* ---------------- 任务记录 ----------------
     只记录用户亲手拖入／选择的文件，不含任何自动抓取的文献。
     仅存元数据（文件名、大小、语言对、状态、时间），不存正文。 */
  const TASK_KEY = 'yisuo.tasks.v1';
  const MAX_TASKS = 20;
  let TASKS = loadTasks();

  /* 上次没译完的（页面刷新／关掉）标为未完成，避免一直显示「翻译中」 */
  TASKS.forEach(function (t) {
    if (t.state === 'running' || t.state === 'queue') {
      t.state = 'error';
      t.note = '未译完（页面已重新打开）';
    }
  });

  function loadTasks() {
    try {
      const arr = JSON.parse(localStorage.getItem(TASK_KEY) || '[]');
      return Array.isArray(arr) ? arr.filter((t) => t && t.name) : [];
    } catch (e) { return []; }
  }
  function saveTasks() {
    try { localStorage.setItem(TASK_KEY, JSON.stringify(TASKS.slice(0, MAX_TASKS))); } catch (e) {}
  }

  function addTask(file, langPair, state) {
    const t = {
      id: 't' + Date.now() + Math.random().toString(36).slice(2, 6),
      name: file.name || '未命名',
      size: file.size || 0,
      langPair: langPair || '',
      state: state || 'running',
      pct: 0,
      note: '',
      stamp: now()
    };
    TASKS.unshift(t);
    if (TASKS.length > MAX_TASKS) TASKS.length = MAX_TASKS;
    saveTasks();
    renderLists();
    return t;
  }

  function setTask(id, patch) {
    const t = TASKS.find((x) => x.id === id);
    if (!t) return;
    Object.keys(patch).forEach((k) => { t[k] = patch[k]; });
    saveTasks();
    renderLists();
  }

  function sizeText(s) {
    if (!s) return '—';
    if (s >= 1024 * 1024) return (s / 1024 / 1024).toFixed(1) + ' MB';
    return Math.max(1, Math.round(s / 1024)) + ' KB';
  }

  function taskMeta(t) {
    if (t.state === 'error') return t.note || '处理失败';
    let m = t.langPair + ' · ' + sizeText(t.size) + ' · ' + t.stamp;
    if (t.state === 'running' && t.pct) m += ' · ' + t.pct + '%';
    return m;
  }

  function renderLists() {
    const rows = function (arr, tight) {
      return arr.map((t) => {
        const s = STATE_MAP[t.state] || STATE_MAP.queue;
        const label = (t.state === 'running' && t.pct) ? s.text + ' ' + t.pct + '%' : s.text;
        return '<div class="task-row" style="margin-bottom:10px">' +
          '<span class="row-ico' + (tight ? ' queue-ico' : '') + '">📄</span>' +
          '<div class="row-info' + (tight ? ' is-tight' : '') + '">' +
          '<div class="row-name' + (tight ? ' is-sm' : '') + '">' + esc(t.name) + '</div>' +
          '<div class="row-meta' + (tight ? ' is-sm' : '') + '">' + esc(taskMeta(t)) + '</div></div>' +
          '<span class="pill ' + s.cls + '"><span class="pill-ico">' + s.ico + '</span>' + label + '</span>' +
          '</div>';
      }).join('');
    };

    const queued = TASKS.filter((t) => t.state === 'queue');
    const others = TASKS.filter((t) => t.state !== 'queue');

    $('#recentList').innerHTML = others.length
      ? rows(others, false)
      : '<div class="empty-note">还没有任务 —— 这里只记录你亲手拖入的文献</div>';

    $('#queueList').innerHTML = queued.length
      ? rows(queued, true)
      : '<div class="empty-note">队列为空</div>';
  }

  /* ---------------- 渲染：知识库页 ---------------- */
  function renderKB() {
    $('#statGrid').innerHTML = [
      { ico:'📐', num:KB.sync.principleCount, cap:'译法原则' },
      { ico:'🏷️', num:KB.sync.termCount,      cap:'术语与专名' },
      { ico:'📚', num:KB.sync.sourceCount,    cap:'来源文献' },
      { ico:'🧩', num:KB.sync.pairCount,      cap:'对照句对' }
    ].map((s) =>
      '<div class="stat-card"><span class="card-ico">' + s.ico + '</span>' +
      '<div class="stat-num">' + s.num + '</div>' +
      '<div class="stat-cap">' + s.cap + '</div></div>').join('');

    $('#prinCount').textContent = KB.principles.length + ' 条';
    $('#principleList').innerHTML = KB.principles.map((p) =>
      '<div class="prin-row' + (p.byUser ? ' is-user' : '') + '">' +
      '<div class="prin-name-row"><span class="prin-name">' + esc(p.name) + '</span>' +
      (p.byUser ? '<span class="prin-flag">👤 已裁定</span>' : '') + '</div>' +
      '<div class="prin-desc">' + esc(p.desc) + '</div></div>').join('');

    const groups = {};
    KB.terms.forEach((t) => { (groups[t.group] = groups[t.group] || []).push(t); });
    $('#termCount').textContent = KB.terms.length + ' 条';
    const swatch = { teal:'🟦', purple:'🟪', gold:'🟨' };
    $('#termGroups').innerHTML = Object.keys(groups).map((g) => {
      const list = groups[g];
      return '<div class="term-group">' +
        '<div class="group-head"><span class="swatch">' + swatch[list[0].cat] + '</span>' +
        '<span class="group-name">' + esc(g) + '</span>' +
        '<span class="group-count">' + list.length + ' 条</span></div>' +
        '<div class="chips">' + list.map((t) =>
          '<span class="chip is-' + t.cat + '-chip">' + esc(t.name) + '</span>').join('') +
        '</div></div>';
    }).join('');

    $('#srcCount').textContent = KB.sources.length + ' 篇';
    $('#sourceList').innerHTML = KB.sources.map((s) =>
      '<div class="src-line">' + s.ico + ' ' + esc(s.text) + '</div>').join('');

    $('#updateList').innerHTML = KB.updates.map((u) =>
      '<div class="upd-line">' + esc(u) + '</div>').join('');
  }

  /* ---------------- 语言选择弹窗 ---------------- */
  let selectedLang = 'ES';
  let pendingFile = null;
  let pendingBlocks = null;

  function renderLangs() {
    $('#langList').innerHTML = KB.languages.map((l) =>
      '<button class="lang-opt' + (l.code === selectedLang ? ' is-selected' : '') +
      '" data-code="' + l.code + '">' +
      '<span class="lang-flag">' + l.flag + '</span>' +
      '<span class="lang-name">' + esc(l.name) + '</span>' +
      '<span class="lang-mark">' + (l.code === selectedLang ? '✅' : '○') + '</span>' +
      '</button>').join('');
    $$('#langList .lang-opt').forEach((b) => b.addEventListener('click', () => {
      selectedLang = b.dataset.code;
      renderLangs();
    }));
  }

  function openModal(file, blocks, detect) {
    pendingFile = file;
    pendingBlocks = blocks || null;
    const sub = $('#modalSub');
    if (sub && detect) {
      sub.textContent = '正文汉字占比约 ' + Math.round(detect.ratio * 100) +
        '%，判定为中文文献；默认由外语译为中文，故请先选择输出语言';
    }
    $('#langModal').classList.remove('is-hidden');
  }
  function closeModal() {
    $('#langModal').classList.add('is-hidden');
  }

  $('#laterBtn').addEventListener('click', () => {
    closeModal(); pendingFile = null; pendingBlocks = null;
  });
  $('#langModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });

  $('#startBtn').addEventListener('click', () => {
    const f = pendingFile;
    const b = pendingBlocks;
    closeModal();
    pendingFile = null;
    pendingBlocks = null;
    if (f) enqueue({ file: f, langPair: '中文 → ' + (KB.languages.find((l) => l.code === selectedLang) || {}).name,
      from: 'ZH', to: selectedLang, blocks: b });
  });

  /* ---------------- 语言判定：只看正文内容，不看文件名 ---------------- */
  /* 统计各类文字的数量，据此判定「中文 / 外语」；外语再顺带推断具体语种，
     用于翻译时告诉模型源语言是什么。 */
  function detectLang(blocks) {
    const text = (blocks || []).map((b) => b.text).join('\n').slice(0, 30000);
    const n = (re) => (text.match(re) || []).length;

    const cjk    = n(/[\u4e00-\u9fff\u3400-\u4dbf]/g);   // 汉字
    const kana   = n(/[\u3040-\u30ff]/g);                 // 日文假名
    const hangul = n(/[\uac00-\ud7af]/g);                 // 韩文音节
    const cyr    = n(/[\u0400-\u04ff]/g);                 // 西里尔字母
    const latin  = n(/[A-Za-z]/g);                        // 拉丁字母
    const total  = cjk + kana + hangul + cyr + latin;

    if (!total) return { isZh: false, code: 'EN', label: '未识别文字', ratio: 0 };

    // 日文：假名在「汉字+假名」里占一定比例即判为日语，避免把日文当中文
    if (kana > 0 && kana / (kana + cjk) > 0.1) {
      return { isZh: false, code: 'JA', label: '日语', ratio: cjk / total };
    }
    // 中文：汉字占全部文字的三成半以上
    if (cjk / total > 0.35) {
      return { isZh: true, code: 'ZH', label: '中文', ratio: cjk / total };
    }
    // 其余按主力文字推断源语言，默认按英语处理
    let code = 'EN', label = '英语';
    if (cyr > latin) { code = 'RU'; label = '俄语'; }
    else if (hangul > 0 && hangul >= latin) { code = 'KO'; label = '韩语'; }
    return { isZh: false, code: code, label: label, ratio: cjk / total };
  }

  /* ---------------- 上传 ---------------- */
  async function onFile(file) {
    if (!file) return;

    let blocks = null;
    try {
      blocks = await readBlocks(file);
    } catch (e) {
      toast(e.message);
      return;
    }
    if (!blocks.length) { toast('文件里没读到正文，换一个试试'); return; }

    const d = detectLang(blocks);
    if (d.isZh) {
      openModal(file, blocks, d);
    } else {
      enqueue({ file: file, langPair: d.label + ' → 中文', from: d.code, to: 'ZH', blocks: blocks });
    }
  }

  /* 串行执行：一次只译一篇，其余排队，前一篇结束自动接上 */
  let busy = false;
  const waiting = [];

  function enqueue(item) {
    const t = addTask(item.file, item.langPair, busy ? 'queue' : 'running');
    item.taskId = t.id;
    if (busy) {
      waiting.push(item);
      toast('已排入队列，前一篇译完自动开始');
      return;
    }
    runOne(item);
  }

  async function runOne(item) {
    busy = true;
    try {
      await startRun(item.file, item.langPair, item.from, item.to, item.blocks, item.taskId);
    } catch (e) {
      setTask(item.taskId, { state: 'error', note: String((e && e.message) || e) });
    } finally {
      busy = false;
      const next = waiting.shift();
      if (next) {
        setTask(next.taskId, { state: 'running' });
        runOne(next);
      }
    }
  }

  const dz = $('#dropzone');
  $('#pickBtn').addEventListener('click', (e) => { e.stopPropagation(); $('#fileInput').click(); });
  $('#fileInput').addEventListener('change', (e) => { onFile(e.target.files[0]); e.target.value = ''; });

  ['dragenter','dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault(); dz.classList.add('is-over');
  }));
  ['dragleave','dragend'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('is-over')));
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); dz.classList.remove('is-over');
    onFile(e.dataTransfer && e.dataTransfer.files[0]);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  /* ---------------- 文件解析 ---------------- */
  function decodeEnt(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(+d); })
            .replace(/&amp;/g, '&');
  }

  /* ---------------- 无需翻译的内容 ----------------
     公式、代码、链接、页码、参考文献条目不属于「需要翻译的内容」：
     不送模型、原样带过去，界面上标一枚「保留原文」小签，说明为什么没译。 */
  const RE_URL     = /^(?:https?:\/\/|www\.|doi:|DOI:)\S+$/;
  const RE_MAIL    = /^[\w.+-]+@[\w-]+\.[\w.-]+$/;
  const RE_NUMONLY = /^[\d\s.,:;()\[\]%°′″+\-×÷=±<>~]{1,40}$/;
  const RE_PAGE    = /^(?:page|p\.|第)\s*\d{1,4}\s*(?:页)?$/i;
  const RE_TEX     = /\\(?:frac|sqrt|sum|int|oint|prod|begin|end|times|cdot|partial|nabla|alpha|beta|gamma|delta|theta|sigma|omega|mu|lambda|leq|geq|approx|equiv|rightarrow|infty)\b|\$\$|\\begin\{|\\\[/;
  const RE_INMATH  = /^\$([\s\S]+)\$$/;                    // 行内公式 $…$
  const RE_MATHISH = /[=^_\\{}]|[∑∫√≤≥→∞±×÷]/;             // 里面得像公式，别把 "$100 和 $200" 误判
  const RE_MATHSYM = /[∑∫∮√∈∉⊂⊆∪∩≈≤≥→←⇒∂∇∞±×÷]/g;
  const RE_REFHEAD = /^(?:\[\d+\]|\d{1,3}[.、])\s*.{8,}$/;
  const RE_REFMARK = /\b(?:et al\.|pp\.|Vol\.|No\.|doi:|https?:\/\/|Retrieved|ISBN|Springer|Elsevier|IEEE|Proceedings|Journal|Trans\.)\b|(?:19|20)\d{2}/;

  /* 返回 null = 正常送译；返回字符串 = 保留原因 */
  function keepReason(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    if (RE_URL.test(s) || RE_MAIL.test(s)) return '链接';
    if (RE_PAGE.test(s)) return '页码';
    if (RE_NUMONLY.test(s)) return '数据';
    if (RE_TEX.test(s)) return '公式';
    const inline = s.match(RE_INMATH);
    if (inline && RE_MATHISH.test(inline[1])) return '公式';
    const sym = s.match(RE_MATHSYM);
    if (sym && sym.length >= 3 && s.length <= 200) return '公式';
    if (RE_REFHEAD.test(s) && RE_REFMARK.test(s)) return '参考文献';
    return null;
  }

  /* 纯文本 / Markdown → 区块：保留标题、列表、引用、代码、表格与图片 */
  function parseText(raw) {
    const lines = String(raw).replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let inCode = false, codeBuf = [], codeLang = '';

    const flushCode = function () {
      if (codeBuf.length) {
        blocks.push({ type: 'code', text: codeBuf.join('\n'), lang: codeLang, keep: true, keepTag: '代码' });
      }
      codeBuf = []; codeLang = '';
    };

    lines.forEach(function (ln) {
      const fence = ln.match(/^\s*(?:```|~~~)\s*(\w*)/);
      if (fence) {
        if (inCode) { flushCode(); inCode = false; }
        else { inCode = true; codeLang = fence[1] || ''; }
        return;
      }
      if (inCode) { codeBuf.push(ln); return; }

      const s = ln.trim();
      if (!s) return;

      let img = s.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
      if (img) {
        blocks.push({ type: 'img', text: '', img: { src: img[2], alt: img[1] || '原文件图片' },
                      keep: true, keepTag: '图片' });
        return;
      }
      const kr = keepReason(s);
      if (kr) { blocks.push({ type: 'raw', text: s, keep: true, keepTag: kr }); return; }
      if (/^\|.*\|$/.test(s)) { blocks.push({ type: 'table', text: s }); return; }

      if (/^#{1,6}\s/.test(s)) {
        const lv = (s.match(/^#+/) || [''])[0].length;
        blocks.push({ type: lv <= 1 ? 'title' : 'h3', text: s.replace(/^#+\s*/, '') });
      } else if (/^[-*]\s/.test(s)) {
        blocks.push({ type: 'li', text: s.replace(/^[-*]\s*/, '') });
      } else if (/^>\s?/.test(s)) {
        blocks.push({ type: 'quote', text: s.replace(/^>\s*/, '') });
      } else {
        blocks.push({ type: 'p', text: s });
      }
    });
    flushCode();
    return blocks;
  }

  /* ---- ZIP 读取（浏览器原生 DecompressionStream，零依赖） ----
     一次性登记所有条目，正文与图片都可能用到。 */
  function readZipEntries(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const out = {};
    for (let i = 0; i + 30 <= buf.length; i++) {
      if (dv.getUint32(i, true) !== 0x04034b50) continue;
      const method = dv.getUint16(i + 8, true);
      const csize = dv.getUint32(i + 18, true);            // 偏移 18：压缩后大小
      const nlen = dv.getUint16(i + 26, true);
      const elen = dv.getUint16(i + 28, true);
      if (!csize || i + 30 + nlen + elen > buf.length) continue;
      let name = '';
      try { name = new TextDecoder().decode(buf.subarray(i + 30, i + 30 + nlen)); } catch (e) { continue; }
      if (!/^[\w./\-]+$/.test(name)) continue;
      const start = i + 30 + nlen + elen;
      out[name] = { method: method, data: buf.subarray(start, Math.min(start + csize, buf.length)) };
      i = start + csize - 1;                               // 跳过数据区
    }
    return out;
  }

  async function inflateEntry(e) {
    if (!e) return null;
    if (e.method === 0) return e.data;
    if (e.method === 8) {
      if (typeof DecompressionStream !== 'function') return null;
      const ds = new DecompressionStream('deflate-raw');
      const b = await new Response(new Blob([e.data]).stream().pipeThrough(ds)).arrayBuffer();
      return new Uint8Array(b);
    }
    return null;
  }

  const IMG_MIME = {
    png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif',
    bmp:'image/bmp', webp:'image/webp', svg:'image/svg+xml', emf:'image/x-emf', wmf:'image/x-wmf'
  };
  function toObjectURL(bytes, name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    const mime = IMG_MIME[ext] || 'image/png';
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  }

  /* docx → 区块；内嵌图片按原位置插入，不丢 */
  async function parseDocx(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const z = readZipEntries(buf);

    const xmlBytes = await inflateEntry(z['word/document.xml']);
    if (!xmlBytes) throw new Error('未能读取 docx 正文（可能是不支持的压缩方式）');
    const xml = new TextDecoder().decode(xmlBytes);

    /* rId → 图片在 zip 里的路径 */
    const relMap = {};
    if (z['word/_rels/document.xml.rels']) {
      const rb = await inflateEntry(z['word/_rels/document.xml.rels']);
      if (rb) {
        const rs = new TextDecoder().decode(rb);
        (rs.match(/<Relationship\b[^>]*\/?>/g) || []).forEach(function (tag) {
          const id = (tag.match(/\bId="([^"]+)"/) || [])[1];
          const tg = (tag.match(/\bTarget="([^"]+)"/) || [])[1];
          if (id && tg) relMap[id] = tg;
        });
      }
    }

    const blocks = [];
    const segs = xml.split(/<w:p[\s>]/).slice(1);

    /* 先扫一遍每段的最大字号（w:sz，单位半磅），算正文中位字号，
       用于「无显式 pStyle」时按字号反推标题（兼容 pdf2docx 这类不写样式的转换结果） */
    const segHeads = segs.map(function (s) { return s.split('</w:p>')[0]; });
    const sizes = segHeads.map(function (h) {
      const m = h.match(/w:sz\b[^>]*?w:val="(\d+)"/g) || [];
      let max = 0;
      m.forEach(function (tag) {
        const v = parseInt((tag.match(/w:val="(\d+)"/) || [])[1], 10);
        if (!isNaN(v) && v > max) max = v;
      });
      return max;
    });
    const nonzero = sizes.filter(function (s) { return s > 0; }).sort(function (a, b) { return a - b; });
    const medianSz = nonzero.length ? nonzero[Math.floor(nonzero.length / 2)] : 21;

    for (let k = 0; k < segs.length; k++) {
      const head = segHeads[k];

      /* 图片：一段里可能有 0~n 张，按出现顺序插入 */
      const draws = head.match(/<w:drawing\b[\s\S]*?<\/w:drawing>|<w:pict\b[\s\S]*?<\/w:pict>/g) || [];
      for (let d = 0; d < draws.length; d++) {
        const rid = (draws[d].match(/r:(?:embed|id|link)="([^"]+)"/) || [])[1];
        const target = rid ? relMap[rid] : null;
        if (!target) continue;
        let zipName = target.charAt(0) === '/' ? target.slice(1) : 'word/' + target.replace(/^\.\//, '');
        const bytes = await inflateEntry(z[zipName]);
        if (!bytes || !bytes.length) continue;
        blocks.push({ type: 'img', text: '', img: { src: toObjectURL(bytes, zipName), alt: '原文件图片' },
                      keep: true, keepTag: '图片' });
      }

      const ts = head.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
      const txt = decodeEnt(ts.map(function (t) { return t.replace(/<[^>]+>/g, ''); }).join('')).trim();
      if (!txt) continue;

      const kr = keepReason(txt);
      if (kr) { blocks.push({ type: 'raw', text: txt, keep: true, keepTag: kr }); continue; }

      const style = (head.match(/w:pStyle[^>]*w:val="([^"]+)"/) || [])[1] || '';
      const isList = /w:numPr/.test(head);
      const maxSz = sizes[k];
      let type = 'p';
      if (isList) type = 'li';
      else if (/^(?:Title|Heading1|1)$/i.test(style)) type = 'title';
      else if (/^(?:Heading|heading|[2-9])/.test(style)) type = 'h3';
      /* 无样式时按字号反推：pdf2docx 等转换结果常只保留字号。
         以正文中位字号为基准：≥1.6 倍判为标题，≥1.2 倍判为小标题。 */
      else if (maxSz >= medianSz * 1.6) type = 'title';
      else if (maxSz && maxSz >= medianSz * 1.2) type = 'h3';
      blocks.push({ type: type, text: txt });
    }
    return blocks;
  }

  /* 从 pdf.js 的绘制指令里取出该页内嵌的位图（jpg/png 等），转成可显示的 URL。
     取不到就返回空数组 —— 图片是加分项，失败不影响正文。 */
  async function pdfPageImages(lib, page) {
    const urls = [];
    try {
      const ops = await page.getOperatorList();
      const paintImg = lib.OPS && lib.OPS.paintImageXObject;
      const paintJpg = lib.OPS && lib.OPS.paintJpegXObject;
      const seen = {};
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        if (fn !== paintImg && fn !== paintJpg) continue;
        let id = ops.argsArray[i] && ops.argsArray[i][0];
        if (id && typeof id === 'object') id = id.id;   // 新版 pdf.js 把 id 包成对象
        if (!id || seen[id]) continue;
        seen[id] = 1;
        let img = null;
        try { img = await page.objs.get(id); } catch (e) { img = null; }
        if (!img || !img.data || !img.width || !img.height) continue;
        // 过滤掉蒙版、极小装饰图；放宽尺寸上限以容纳大幅图表
        if (img.width < 40 || img.height < 40) continue;
        if (img.width * img.height > 8000 * 8000) continue;
        try {
          const c = document.createElement('canvas');
          c.width = img.width; c.height = img.height;
          const ctx = c.getContext('2d');
          const idata = ctx.createImageData(img.width, img.height);
          idata.data.set(img.data);
          ctx.putImageData(idata, 0, 0);
          urls.push(c.toDataURL('image/png'));
        } catch (e) { /* 单张失败不拖累整篇 */ }
      }
    } catch (e) { /* 不支持就直接没有图片 */ }
    return urls;
  }

  /* 整页渲染为 data URL（扫描件 OCR 的可靠图片源）。
     用 JPEG 且限制宽度，避免 base64 过大超出请求体上限。 */
  async function renderPageToDataURL(page, maxW) {
    try {
      const vp = page.getViewport({ scale: 1 });
      const scale = (maxW && vp.width > maxW) ? (maxW / vp.width) : 1;
      const v2 = page.getViewport({ scale: scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(v2.width));
      canvas.height = Math.max(1, Math.round(v2.height));
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: v2 }).promise;
      return canvas.toDataURL('image/jpeg', 0.85);
    } catch (e) { return null; }
  }

  /* PDF → 区块：逐页提取文本层，保留分页与内嵌图片 */
  async function parsePdf(file) {
    const lib = window.pdfjsLib;
    if (!lib) throw new Error('PDF 组件还在加载，请稍等两秒再试');

    const buf = new Uint8Array(await file.arrayBuffer());
    const doc = await lib.getDocument({ data: buf }).promise;
    const raw = [];   // { text, size, page }
    const pageImgs = {};     // 内嵌图片（插图），保留不翻译
    const pageRenders = {};  // 整页渲染（扫描件交给视觉模型 OCR）
    let imgCount = 0;

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      /* 先按「上→下、同行左→右」排序，再聚类成行。
         PDF 文字项是按绘制顺序给的，基线常有 1~2px 抖动；
         旧逻辑用 2px 容差一刀切，抖动稍大就把同一行拆成好几行 → 无故换行。
         改成按行内最大字号动态容差聚类，行内用空格连接（避免词粘在一起）。 */
      const items = (tc.items || []).filter(function (it) {
        return it.str != null && it.str.length && it.transform;
      });
      items.sort(function (a, b) {
        const ya = Math.round(a.transform[5]), yb = Math.round(b.transform[5]);
        if (ya !== yb) return yb - ya;          // PDF 的 y 向上增长，大的在上方，先读
        return a.transform[4] - b.transform[4];
      });
      const hs = items.map(function (it) { return Math.abs(it.transform[3]) || it.height || 10; })
                       .sort(function (a, b) { return a - b; });
      const medH = hs.length ? hs[Math.floor(hs.length / 2)] : 10;
      const LINE_TOL = Math.max(2.5, medH * 0.55);
      const lines = [];
      let cur = null, curY = null;
      items.forEach(function (it) {
        const y = Math.round(it.transform[5]);
        if (cur === null || Math.abs(y - curY) > LINE_TOL) { cur = []; lines.push(cur); curY = y; }
        cur.push(it);
      });
      lines.forEach(function (line) {
        const t = line.map(function (it) { return it.str; }).join(' ').replace(/\s+/g, ' ').trim();
        if (!t) return;
        const sz = Math.max.apply(null, line.map(function (it) {
          return Math.abs(it.transform[3]) || it.height || medH;
        }));
        raw.push({ text: t, size: sz, page: p });
      });

      // 整页渲染：扫描件无文本层时，作为送给视觉模型的可靠图片
      let render = null;
      try { render = await renderPageToDataURL(page, 1400); } catch (e) { render = null; }
      if (render) pageRenders[p] = render;

      if (imgCount < 60) {
        const imgs = await pdfPageImages(lib, page);
        if (imgs.length) { pageImgs[p] = imgs; imgCount += imgs.length; }
      }
    }
    try { await doc.destroy(); } catch (e) {}

    if (!raw.length && !Object.keys(pageRenders).length) {
      throw new Error('这个 PDF 没有任何可提取的文字或图像，无法翻译');
    }

    // 正文众数字号，作为标题判断基准（仅在有文本层时统计）
    const tally = {};
    raw.forEach(function (r) { const k = Math.round(r.size); tally[k] = (tally[k] || 0) + 1; });
    let base = 0, best = 0;
    Object.keys(tally).forEach(function (k) { if (tally[k] > best) { best = tally[k]; base = +k; } });
    if (!base) base = 12;

    const blocks = [];
    for (let p = 1; p <= doc.numPages; p++) {
      blocks.push({ type: 'page', text: '第 ' + p + ' 页', keep: true, keepTag: '分页' });
      const pageTexts = raw.filter(function (r) { return r.page === p; });
      if (pageTexts.length) {
        // 有文本层：按文本块翻译（标题 / 列表 / 段落）
        pageTexts.forEach(function (r) {
          const text = r.text.replace(/\s+/g, ' ').trim();
          if (!text) return;
          const kr = keepReason(text);
          if (kr) { blocks.push({ type: 'raw', text: text, keep: true, keepTag: kr }); return; }
          if (r.size >= base * 1.6) blocks.push({ type: 'title', text: text });
          else if (r.size >= base * 1.25) blocks.push({ type: 'h3', text: text });
          else blocks.push({ type: 'p', text: text });
        });
        (pageImgs[p] || []).forEach(function (src) {
          blocks.push({ type: 'img', text: '', img: { src: src, alt: '原文件第 ' + p + ' 页图片' },
                        keep: true, keepTag: '图片' });
        });
      } else if (pageRenders[p]) {
        // 无文本层（扫描件）：整页图片交给视觉模型 OCR + 翻译
        blocks.push({ type: 'page-img', text: '', keep: false, needVision: true,
                      img: { src: pageRenders[p], alt: '第 ' + p + ' 页（扫描件，已用视觉模型识别）' } });
      } else {
        blocks.push({ type: 'p', text: '（第 ' + p + ' 页无可提取内容）', keep: true });
      }
    }
    return blocks;
  }

  /* 读文件 → 区块（失败抛错） */
  /* PDF → DOCX 转换（服务端 /api/convert，底层 pdf2docx）。
     成功返回 DOCX 的 File 对象；任何失败（无转换器/超时/解析失败）都返回 null，
     由调用方退回原生 PDF 解析。绝不抛出异常阻断主流程。 */
  async function convertPdfToDocx(file) {
    try {
      const r = await fetch('/api/convert', {
        method: 'POST', body: file, headers: { 'Content-Type': 'application/pdf' }
      });
      const ct = r.headers.get('Content-Type') || '';
      /* 后端无转换器或失败时返回 JSON {ok:false}，据此退回原生解析 */
      if (ct.indexOf('json') >= 0) return null;
      if (!r.ok) return null;
      const buf = await r.arrayBuffer();
      if (!buf || !buf.byteLength) return null;
      const name = (file.name || 'doc.pdf').replace(/\.pdf$/i, '.docx');
      return new File([buf], name, {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });
    } catch (e) { return null; }
  }

  let gViaDocxConvert = false;   // 本次是否走了「PDF→DOCX」路径（供日志提示）

  async function readBlocks(file) {
    const name = file.name.toLowerCase();
    if (/\.docx$/.test(name)) return parseDocx(file);
    if (/\.pdf$/.test(name)) {
      /* 优先转 DOCX：DOCX 解析能保留标题层级、列表、内嵌图片与表格结构，
         比直接抽 PDF 文本层更贴近原排版；转换失败再退回原生 PDF 解析。 */
      gViaDocxConvert = false;
      const docx = await convertPdfToDocx(file);
      if (docx) { gViaDocxConvert = true; return parseDocx(docx); }
      return parsePdf(file);
    }
    if (/\.(txt|md|markdown|srt|text)$/.test(name) || /^text\//.test(file.type)) {
      const raw = await new Promise(function (res, rej) {
        const r = new FileReader();
        r.onload = function () { res(String(r.result || '')); };
        r.onerror = function () { rej(new Error('读取失败')); };
        r.readAsText(file, 'utf-8');
      });
      return parseText(raw);
    }
    throw new Error('暂不支持该文件类型，请先转成 txt / md / docx');
  }

  /* 区块 ↔ 段落（带层级前缀，供模型还原排版） */
  function blocksToParas(blocks) {
    return blocks.map(function (b) {
      if (b.type === 'title') return '# ' + b.text;
      if (b.type === 'h3') return '## ' + b.text;
      if (b.type === 'li') return '- ' + b.text;
      if (b.type === 'quote') return '> ' + b.text;
      return b.text;
    });
  }
  /* 单段译文清洗：层级由原文决定，这里只剥掉模型常在段首加的噪声
     （加粗、「译文：」、代码围栏、复述的段号标记）。
     编号类前缀（1. / 3.2）只在原文同位置也有编号时才剥 ——
     否则 "3.2 Results" 会被削成 "2 Results"。 */
  function cleanTranslated(s, srcText) {
    let t = String(s == null ? '' : s).trim();
    t = t.replace(/^\s*(?:```|~~~)[a-zA-Z]*\s*/, '').replace(/\s*(?:```|~~~)\s*$/, '');
    t = t.replace(/^\s*#{1,6}\s*/, '');
    t = t.replace(/^\s*[-*>]\s*/, '');
    t = t.replace(/^\s*[（(【\[][^）)】\]]*[）)】\]]\s*/, '');
    t = t.replace(/^\s*(?:译文|翻译)\s*[:：]\s*/, '');
    /* 剥模型复述的段号：译段以「P12:」「P12.」开头而原文没有 */
    t = t.replace(/^\s*[Pp]\s*\d+\s*[.、:：)）]\s*(?=[^\s])/, '');
    /* 数字编号：译文段号恰好等于原文段号时，那是模型在复述位置，剥掉；
       编号不同（如原文 3.2、译文 3.2）说明是内容的一部分，保留。
       依据：模型复述只发生在「块内序号」上（1..8），不会复述小节号。 */
    const sn = String(srcText || '').match(/^\s*(\d+(?:\.\d+)*[.、)．]?)\s+/);
    if (sn) {
      const vn = t.match(/^\s*(\d+(?:\.\d+)*[.、)．]?)\s+/);
      if (vn && /^\d+$/.test(vn[1]) && vn[1] === sn[1].replace(/[.、)．]$/, '')) {
        t = t.slice(vn[0].length);
      }
    }
    /* 原文编号带尾缀（1. / 1)），译文复述成一样时也剥。
       编号后必须跟空白：否则 "3.2" 里的小数点会被当成 "3." 的尾缀 */
    const s2 = String(srcText || '').match(/^\s*(\d+)([.、)．])(?=\s)/);
    if (s2) t = t.replace(new RegExp('^\\s*' + s2[1] + '\\' + s2[2] + '\\s*'), '');
    t = t.replace(/^\s*\*{1,3}\s*/, '').replace(/\s*\*{1,3}\s*$/, '');
    return t.trim();
  }

  /* ---------------- 翻译流程 ---------------- */
  const STEPS = [
    { key:'parse',   label:'解析原文',   ico:'✅' },
    { key:'sync',    label:'同步知识库', ico:'✅' },
    { key:'segment', label:'分段翻译',   ico:'✅' },
    { key:'annot',   label:'名词注释',   ico:'⏳' },
    { key:'layout',  label:'还原排版',   ico:'5️⃣' }
  ];

  function renderSteps(activeIdx) {
    $('#steps').innerHTML = STEPS.map((s, i) => {
      let cls = 'step-todo', ico = s.ico;
      if (i < activeIdx) { cls = 'step-done'; ico = '✅'; }
      else if (i === activeIdx) { cls = 'step-active'; ico = '⏳'; }
      return '<span class="step ' + cls + '"><span class="step-ico">' + ico + '</span>' + s.label + '</span>';
    }).join('');
  }

  function addLog(text, type) {
    const box = $('#logbox');
    const d = document.createElement('div');
    d.className = 'log-line log-' + type;
    d.textContent = now() + ' ' + text;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let currentTaskId = null;

  function setPct(pct, note) {
    $('#pctText').textContent = pct + '%';
    $('#progressFill').style.width = pct + '%';
    if (note) $('#pctNote').textContent = note;
    if (currentTaskId) setTask(currentTaskId, { pct: pct });   // 任务列表实时跟随
  }

  async function startRun(file, langPair, fromCode, toCode, preBlocks, taskId) {
    fromCode = fromCode || 'EN';
    toCode = toCode || 'ZH';
    currentTaskId = taskId || null;

    showView('running');
    $('#runFileName').textContent = file.name;
    const size = (file.size / 1024 / 1024).toFixed(1);
    $('#runFileMeta').textContent = size + ' MB';
    $('#runLangPair').textContent = langPair;
    $('#logbox').innerHTML = '';
    setPct(0, '准备中');

    addLog('✅ 开始处理：' + file.name, 'done');

    /* —— 1 解析原文 —— */
    renderSteps(0);
    if (/\.pdf$/i.test(file.name || '')) setPct(8, '正在将 PDF 转为 DOCX（保留排版与图片）…');
    else setPct(8, '正在解析原文…');
    let blocks = preBlocks || null;
    if (!blocks) {
      try {
        blocks = await readBlocks(file);
        if (gViaDocxConvert) {
          addLog('✅ PDF 已先转为 DOCX 再解析 —— 标题/列表/图片/表格按原结构保留', 'done');
        } else if (/\.pdf$/i.test(file.name || '')) {
          addLog('ℹ️ 本次未走 PDF→DOCX（转换器不可用或转换失败），已退回原生 PDF 解析', 'run');
        }
      } catch (e) {
        addLog('⚠️ ' + e.message, 'err');
        toast(e.message);
        if (taskId) setTask(taskId, { state: 'error', note: e.message, pct: 0 });
        currentTaskId = null;
        setTimeout(function () { showView('empty'); }, 1600);
        return;
      }
    }
    if (!blocks.length) {
      toast('文件里没读到正文');
      if (taskId) setTask(taskId, { state: 'error', note: '没读到正文', pct: 0 });
      currentTaskId = null;
      showView('empty');
      return;
    }
    $('#runFileMeta').textContent = blocks.length + ' 段 · ' + size + ' MB';
    addLog('✅ 解析完成 —— ' + blocks.length + ' 个段落', 'done');

    /* —— 2 同步知识库 —— */
    renderSteps(1);
    setPct(22, '正在同步知识库…');
    addLog('✅ 知识库同步完成 —— 载入 ' + KB.sync.principleCount +
      ' 条原则、' + KB.sync.termCount + ' 条术语', 'done');
    await sleep(240);

    /* —— 3 分段翻译 —— */
    renderSteps(2);
    setPct(36, '正在分段翻译…');
    const ready = await Translator.detect();
    let outBlocks = null;
    let missedCount = 0;
    let failReason = '';

    /* 需要翻译的段 —— 文字块送文字引擎，扫描页/纯图块送视觉引擎，其余原样保留 */
    const textIdx = [];
    const visionIdx = [];
    blocks.forEach(function (b, i) {
      if (b.keep) return;
      if (b.type === 'page-img') visionIdx.push(i);
      else textIdx.push(i);
    });
    const keepCount = blocks.length - textIdx.length - visionIdx.length;
    const imgCount = blocks.filter(function (b) { return b.type === 'img'; }).length;
    const visionCount = visionIdx.length;

    if (ready) {
      addLog('⏳ 翻译引擎已接入 —— 按 ' + KB.sync.principleCount + ' 条原则逐段翻译', 'run');
      if (keepCount) {
        addLog('ℹ️ ' + keepCount + ' 段按原样保留（公式/代码/链接/页码/参考文献/图片），不送模型', 'run');
      }
      if (visionCount) {
        addLog('🖼️ ' + visionCount + ' 页为扫描件/纯图，交视觉模型（GLM-4.6V）识别翻译', 'run');
      }
      const full = blocks.map(function (b) { return Object.assign({}, b); });
      let missed = 0;
      let ok = true;
      let firstError = '';

      /* —— 文字块 —— */
      if (textIdx.length) {
        const paras = textIdx.map(function (i) { return blocksToParas([blocks[i]])[0]; });
        const total = paras.length;
        const res = await Translator.translate(paras, fromCode, toCode, function (done) {
          setPct(36 + Math.round((done / Math.max(total, 1)) * 38), '已译 ' + done + ' / ' + total + ' 段');
        });
        if (res.ok) {
          /* 回写：保留段原样，其余用译文；模型没译出的保留原文并标黄 —— 绝不冒充译文 */
          res.paragraphs.forEach(function (t, k) {
            const gi = textIdx[k];
            const src = blocks[gi];
            const empty = (t === null || t === undefined || !String(t).trim());
            full[gi] = Object.assign({}, src, {
              text: empty ? src.text : cleanTranslated(t, src.text),
              miss: empty
            });
          });
          const m = (res.missing || []).length;
          missed += m;
          if (res.error && m) firstError = res.error;
        } else {
          ok = false;
          firstError = res.error || '未知错误';
        }
      }

      /* —— 视觉块（扫描页/纯图）—— 文字引擎整体失败时跳过，避免无谓调用 */
      if (ok && visionIdx.length) {
        const vTotal = visionIdx.length;
        let vDone = 0;
        await Promise.all(visionIdx.map(async function (gi) {
          const src = blocks[gi];
          let txt = null;
          try {
            txt = await Translator.translateImage(src.img.src, fromCode, toCode);
          } catch (e) { txt = null; }
          vDone += 1;
          setPct(74 + Math.round((vDone / vTotal) * 8), '已译图页 ' + vDone + ' / ' + vTotal);
          const empty = (txt === null || txt === undefined || !String(txt).trim());
          full[gi] = Object.assign({}, src, {
            text: empty ? '' : String(txt).trim(),
            miss: empty
          });
          if (empty) missed += 1;
        }));
      }

      if (ok) {
        outBlocks = full;
        if (missed) {
          addLog('⚠️ 有 ' + missed + ' 段未译出，已保留原文并标黄', 'err');
          if (firstError) {
            addLog('   原因：' + firstError + '（个别块失败已被隔离，其余译文保留）', 'err');
          }
          addLog('   提示：可换更强模型（如 glm-4-plus / deepseek-chat），或重新运行本段', 'err');
        } else {
          addLog('✅ 翻译完成 —— ' + outBlocks.length + ' 段', 'done');
        }
        missedCount = missed;
      } else {
        failReason = firstError;
        addLog('⚠️ 翻译失败：' + failReason, 'err');
        toast('翻译失败：' + failReason);
      }
    } else {
      failReason = '未检测到翻译引擎（server/.env 里没填 API Key）';
      addLog('⚠️ ' + failReason + ' —— 不产出译文', 'err');
    }

    /* —— 4 名词注释 —— */
    renderSteps(3);
    setPct(86, '正在为专业名词加注…');
    await sleep(260);

    /* —— 5 还原排版 —— */
    renderSteps(4);
    setPct(95, '正在还原排版…');
    await sleep(260);

    /* 译不出来就给一张说明卡，绝不用别处的文字冒充译文 */
    const finalBlocks = outBlocks || [];

    renderSteps(STEPS.length);
    setPct(100, outBlocks ? '完成' : '未完成');
    $('#hitUsed').textContent = countUsedTerms(finalBlocks) + ' 条';
    addLog(outBlocks
      ? '✅ 排版还原完成 —— 层级、图片与无需翻译的内容均按原文件保留'
      : '⚠️ 未产出译文', outBlocks ? 'done' : 'err');
    await sleep(300);

    let termWarns = [];
    if (outBlocks) {
      termWarns = checkTerms(blocks, outBlocks);
      if (termWarns.length) {
        addLog('⚠️ ' + termWarns.length + ' 个术语在译文中未采用表中译法，见右下「译法待核」', 'err');
      }
    }

    /* —— 4.5 自动抽词：把译文里出现的专业名词挑出来标色 + 进右侧面板。
       这一步失败（如引擎抽词异常）不影响已完成的译文，仅少一批自动注释。 */
    let autoTerms = [];
    if (outBlocks) {
      setPct(92, '正在为专业名词加注…');
      addLog('⏳ 大模型正在识别本文专业名词…', 'run');
      try {
        autoTerms = await extractTerms(finalBlocks, toCode);
        if (autoTerms.length) {
          addLog('✅ 自动识别 ' + autoTerms.length + ' 个专业名词（已标色，见右侧）', 'done');
        } else {
          addLog('ℹ️ 未提取到额外专业名词（或引擎未就绪）', 'run');
        }
      } catch (e) {
        autoTerms = [];
        addLog('ℹ️ 自动抽词跳过：' + (e && e.message ? e.message : e), 'run');
      }
      setPct(100, outBlocks ? '完成' : '未完成');
    }

    /* 存一份给「导出」：图片（blob:/data:）、层级、术语都还在 blocks 里 */
    lastResult = {
      file: file, langPair: langPair, blocks: finalBlocks,
      isReal: !!outBlocks, termWarns: termWarns, autoTerms: autoTerms,
      stat: { keep: keepCount, img: imgCount, missed: missedCount }
    };

    renderResult(file, langPair, finalBlocks, !!outBlocks, blocks.length, termWarns,
                 failReason, { keep: keepCount, img: imgCount, missed: missedCount }, autoTerms);
    showView('result');

    if (taskId) {
      if (!outBlocks) setTask(taskId, { state: 'error', note: failReason || '未产出译文', pct: 100 });
      else setTask(taskId, { state: 'done', pct: 100 });
    }
    currentTaskId = null;
  }

  function countUsedTerms(blocks) {
    const text = (blocks || []).map((b) => b.text).join('');
    const found = new Set();
    KB.terms.forEach((t) => { if (text.indexOf(t.name) >= 0) found.add(t.name); });
    return found.size;
  }

  /* ---------------- 渲染：译文 + 名词注释 ---------------- */
  /* 术语一致性核查：原文里有该术语，译文里却没用表中的译名 → 提示待核。
     这样「养成体系是否真的生效」是看得见的，而不是盲目相信模型。 */
  function checkTerms(srcBlocks, outBlocks) {
    const src = (srcBlocks || []).map((b) => b.text).join('');
    const out = (outBlocks || []).map((b) => b.text).join('');
    const hit = [];
    KB.terms.forEach((t) => {
      if (src.indexOf(t.en) >= 0 && out.indexOf(t.name) < 0) hit.push(t);
    });
    return hit;
  }

  /* 术语渲染：彩色词 + 紧跟括号释义 */
  function termHTML(t) {
    return '<span class="term term-' + t.cat + '">' + esc(t.name) + '</span>' +
           '<span class="term-note">（' + esc(t.gloss) + '）</span>';
  }

  /* 先处理 [[标记]]，再按术语名直接匹配（长名优先，避免短名抢占）。
     extraList：本文经大模型自动提取的专业术语（{name, gloss, cat, detail, src}），
     与 KB.terms 合并后按名称去重，一并高亮 + 进右侧名词面板。 */
  function annotate(text, extraList) {
    const found = [];
    const slots = [];
    const stash = function (h) { slots.push(h); return '\u0000' + (slots.length - 1) + '\u0000'; };

    const kbNames = {};
    KB.terms.forEach(function (t) { if (t && t.name) kbNames[t.name] = 1; });
    const seen = {};
    const list = KB.terms.slice();
    (extraList || []).forEach(function (t) {
      /* 与 KB 重名的术语已由三色标注，自动提取项跳过，避免重复高亮 */
      if (t && t.name && !kbNames[t.name] && !seen[t.name]) { seen[t.name] = 1; list.push(t); }
    });

    let src = esc(text);

    list.forEach((t) => {
      const marker = '[[' + t.name + ']]';
      let idx;
      while ((idx = src.indexOf(marker)) >= 0) {
        found.push(t);
        src = src.slice(0, idx) + stash(termHTML(t)) + src.slice(idx + marker.length);
      }
    });

    list.slice().sort((a, b) => (b.name || '').length - (a.name || '').length).forEach((t) => {
      const nm = t.name || '';
      if (!nm) return;
      let idx = 0, guard = 0;
      while ((idx = src.indexOf(nm, idx)) >= 0 && guard++ < 40) {
        found.push(t);
        src = src.slice(0, idx) + stash(termHTML(t)) + src.slice(idx + nm.length);
        idx += 3;
      }
    });

    const html = src.replace(/\u0000(\d+)\u0000/g, function (m, d) { return slots[+d]; });
    return { html, found };
  }

  /* 从模型返回的任意文本里抠出 JSON 数组；兼容代码围栏与多余文字 */
  function parseTermJSON(s) {
    if (!s) return [];
    let t = String(s).trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    try { const v = JSON.parse(t); return Array.isArray(v) ? v : []; } catch (e) {}
    const m = t.match(/\[[\s\S]*\]/);
    if (m) { try { const v = JSON.parse(m[0]); return Array.isArray(v) ? v : []; } catch (e) {} }
    return [];
  }

  /* 大模型自动抽词：把译文里出现的专业名词挑出来，标色 + 进右侧面板。
     与 KB 术语表互补——KB 是「你的翻译习惯」，这里是「本文实际出现的专业词」。
     失败一律返回空数组，绝不阻断主流程。 */
  async function extractTerms(blocks, toCode) {
    const ready = await Translator.detect();
    if (!ready) return [];
    const text = (blocks || [])
      .filter(function (b) { return b && !b.miss && b.text; })
      .map(function (b) { return b.text; })
      .join('\n');
    if (!text.trim()) return [];

    /* 切块：每块约 3000 字，最多 8 块（覆盖约 2.4 万字，绝大多数文献已全覆盖；
       超长文献仅采样前段，代价是调用次数与延迟可控、绝不卡死主流程） */
    const MAX_CHARS = 3000, MAX_CHUNKS = 8;
    const chunks = [];
    for (let i = 0; i < text.length && chunks.length < MAX_CHUNKS; i += MAX_CHARS) {
      chunks.push(text.slice(i, i + MAX_CHARS));
    }

    const system = '你是文献术语抽取助手。给定一段' + (toCode === 'ZH' ? '中文' : '译文') +
      '文本，找出其中需要解释的专业名词或专名（如机构、法律、技术、学科术语），' +
      '以 JSON 数组返回，每个元素形如 {"name":"术语","gloss":"一句话简明释义"}。' +
      '只输出 JSON 数组，不要代码围栏、不要任何解释。每块最多 12 个，挑最值得解释的词。';

    const collected = {};
    for (let c = 0; c < chunks.length; c++) {
      try {
        const r = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ system: system, text: chunks[c], from: 'AUTO', to: toCode, maxTokens: 3000 })
        });
        const j = await r.json().catch(function () { return null; });
        if (!j || !j.ok) continue;
        (parseTermJSON(j.text) || []).forEach(function (t) {
          if (t && t.name && !collected[t.name]) {
            collected[t.name] = {
              name: String(t.name),
              gloss: String(t.gloss || ''),
              cat: 'green',
              detail: String(t.gloss || ''),
              src: '本文自动提取'
            };
          }
        });
      } catch (e) { /* 单块失败不阻断，继续下一块 */ }
    }

    /* 过滤掉与 KB 术语表重名的（KB 已用三色标过，避免重复） */
    const kbNames = {};
    (window.KB.terms || []).forEach(function (t) { if (t && t.name) kbNames[t.name] = 1; });
    const out = [];
    Object.keys(collected).forEach(function (k) { if (!kbNames[k]) out.push(collected[k]); });
    return out;
  }

  function renderResult(file, langPair, blocks, isReal, srcCount, termWarns, failReason, stat, autoTerms) {
    const body = $('#docBody');
    let html = '';
    const foundMap = {};
    let total = 0;
    stat = stat || {};

    /* 结果页抬头一律来自本次上传的文件，不掺任何别处的文字 */
    const baseName = String((file && file.name) || '译文').replace(/\.[^.]+$/, '');
    $('#resTitle').textContent = isReal ? ('译文 · ' + baseName) : ('未能产出译文 · ' + baseName);
    const eb = $('#docEyebrow');
    eb.textContent = langPair;
    eb.classList.remove('is-hidden');
    const dt = $('#docTitle');
    dt.textContent = baseName;
    dt.classList.remove('is-hidden');

    const srcBox = $('#docSrcBox');
    const srcLine = '原文：' + ((file && file.name) || '—') + ' · ' + (srcCount || blocks.length) + ' 段' +
      (stat.img ? ' · 图片 ' + stat.img + ' 张' : '') +
      (stat.keep ? ' · 原样保留 ' + stat.keep + ' 段' : '') +
      ' · 知识库 ' + KB.sync.termCount + ' 条术语';
    $('#docSrc').textContent = srcLine;
    srcBox.classList.remove('is-hidden');

    const collect = function (r) {
      r.found.forEach((t) => { if (!foundMap[t.name]) { foundMap[t.name] = t; total++; } });
    };
    const countMissed = function (arr) { return arr.filter((b) => b.miss).length; };

    if (!isReal) {
      body.innerHTML = '<div class="doc-empty"><div class="doc-empty-ico">⚠️</div>' +
        '<div class="doc-empty-title">这次没有产出译文</div>' +
        '<div class="doc-empty-desc">' + esc(failReason || '原因未知') + '</div>' +
        '<div class="doc-empty-hint">修好后重跑即可；这里不会用别处的文字顶替你的译文。</div></div>';
    } else {
      blocks.forEach((b) => {
        /* 图片：原文件里的图，原样带过来 */
        if (b.type === 'img') {
          html += '<figure class="doc-fig"><img class="doc-img" src="' + esc(b.img.src) +
                  '" alt="' + esc(b.img.alt || '原文件图片') + '" loading="lazy">' +
                  '<figcaption class="doc-figcap"><span class="keep-tag">保留原图</span>' +
                  esc(b.img.alt || '') + '</figcaption></figure>';
          return;
        }
        /* 扫描页/纯图：视觉引擎识别出的译文 + 原图 */
        if (b.type === 'page-img') {
          const hasTxt = b.text && String(b.text).trim();
          html += '<figure class="doc-fig">';
          if (hasTxt) {
            html += '<p class="doc-p' + (b.miss ? ' is-missed' : '') + '"' +
                    (b.miss ? ' title="视觉模型未译出整页文字"' : '') + '>' +
                    (b.miss ? '<span class="miss-flag">未译</span>' : '') +
                    esc(b.text) + '</p>';
          } else {
            html += '<div class="doc-raw"><span class="keep-tag">' +
                    (b.miss ? '未译' : '保留原图') + '</span>视觉模型未识别出文字</div>';
          }
          html += '<img class="doc-img" src="' + esc(b.img.src) +
                  '" alt="' + esc(b.img.alt || '扫描页') + '" loading="lazy">' +
                  '<figcaption class="doc-figcap"><span class="keep-tag">扫描页</span>' +
                  esc(b.img.alt || '') + '</figcaption></figure>';
          return;
        }
        /* 分页标记 */
        if (b.type === 'page') {
          html += '<div class="doc-page"><span class="keep-tag">' + esc(b.keepTag || '分页') +
                  '</span>' + esc(b.text) + '</div>';
          return;
        }
        /* 代码 */
        if (b.type === 'code') {
          html += '<pre class="doc-code"><span class="keep-tag">' + esc(b.keepTag || '代码') +
                  '</span>' + esc(b.text) + '</pre>';
          return;
        }
        /* 公式 / 链接 / 页码 / 参考文献等：原样保留 */
        if (b.type === 'raw') {
          html += '<div class="doc-raw"><span class="keep-tag">' + esc(b.keepTag || '保留原文') +
                  '</span>' + esc(b.text) + '</div>';
          return;
        }
        if (b.type === 'title') { html += '<h2 class="doc-title">' + esc(b.text) + '</h2>'; return; }
        if (b.type === 'h3')    { html += '<div class="doc-h3">' + esc(b.text) + '</div>'; return; }

        const r = annotate(b.text, autoTerms);
        const cls = 'doc-p' +
          (b.type === 'li' ? ' doc-li' : '') +
          (b.type === 'quote' ? ' doc-quote' : '') +
          (b.type === 'table' ? ' doc-table' : '') +
          (b.miss ? ' is-missed' : '');
        html += '<p class="' + cls + '"' +
                (b.miss ? ' title="这一段模型未译出，显示的是原文"' : '') + '>' +
                (b.miss ? '<span class="miss-flag">未译</span>' : '') +
                (b.type === 'li' ? '• ' : '') +
                (b.type === 'quote' ? '❝ ' : '') + r.html + '</p>';
        collect(r);
      });
      body.innerHTML = html;
    }

    const list = Object.keys(foundMap).map((k) => foundMap[k]);
    $('#annotSub').textContent = '全篇 ' + total + ' 个 · 🟦机构 🟪法律 🟨环境 🟩本文专名';
    $('#resMeta').textContent = langPair + ' · ' + (srcCount || blocks.length) +
      ' 段 · 保留原排版' + (stat.img ? ' · 图片 ' + stat.img + ' 张' : '') +
      ' · ' + total + ' 个名词已加注' +
      (isReal ? '' : ' · 未产出译文') +
      (countMissed(blocks) ? ' · ' + countMissed(blocks) + ' 段未译（已标黄）' : '');

    const swatch = { teal:'🟦', purple:'🟪', gold:'🟨', green:'🟩' };
    const warnHtml = (termWarns && termWarns.length)
      ? '<div class="annot-card is-warn"><div class="annot-name">⚠️ 译法待核 · ' +
        termWarns.length + ' 条</div>' +
        '<div class="annot-desc">这些术语出现在原文里，但译文没有采用知识库中的译名：</div>' +
        termWarns.map((t) =>
          '<div class="warn-row"><b>' + esc(t.en) + '</b> → 应为「' + esc(t.name) + '」</div>').join('') +
        '<div class="annot-src">📎 可手工改译，或换更强的模型后重跑</div></div>'
      : '';

    $('#annotList').innerHTML = warnHtml + (list.length
      ? list.map((t) =>
          '<div class="annot-card is-' + t.cat + '">' +
          '<div class="annot-name"><span class="swatch">' + swatch[t.cat] + '</span> ' + esc(t.name) + '</div>' +
          '<div class="annot-en">' + esc(t.en) + '</div>' +
          '<div class="annot-desc">' + esc(t.detail) + '</div>' +
          '<div class="annot-src">📎 ' + esc(t.src) + '</div>' +
          '</div>').join('')
      : '<div class="annot-card"><div class="annot-desc">本篇未命中术语表中的名词。' +
        '新名词可补进知识库 wiki/entities/ 后重新同步。</div></div>');
  }

  $('#backBtn').addEventListener('click', () => showView('empty'));
  $('#resyncBtn').addEventListener('click', () => {
    $('#syncTime').textContent = '今日 ' + now().slice(0, 5) + ' 更新';
    toast('已与知识库重新同步');
  });

  /* ---------------- 导出 ---------------- */
  let exportFmt = 'docx';
  const fmtSeg = $('#exportFmt');
  if (fmtSeg) {
    $$('.seg-btn', fmtSeg).forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.seg-btn', fmtSeg).forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        exportFmt = btn.getAttribute('data-fmt') || 'docx';
      });
    });
  }
  $('#exportBtn').addEventListener('click', async () => {
    if (!lastResult) { toast('还没有可导出的译文'); return; }
    const btn = $('#exportBtn');
    const old = btn.textContent;
    btn.textContent = '⏳ 生成中…';
    btn.disabled = true;
    try {
      const fmt = await window.YisuoExport.export(exportFmt, lastResult);
      const label = fmt === 'docx' ? 'Word 文档' : fmt === 'md' ? 'Markdown' : '纯文本';
      toast('已导出 ' + label);
    } catch (e) {
      toast('导出失败：' + (e && e.message ? e.message : e));
    } finally {
      btn.textContent = old; btn.disabled = false;
    }
  });

  /* ---------------- 翻译引擎状态 ---------------- */
  function renderEngine() {
    Translator.detect().then(function (ok) {
      const bar = $('#engineBar');
      if (!bar) return;
      if (ok) {
        bar.className = 'rulebar is-ok';
        $('#engineIco').textContent = '🔌';
        $('#engineText').textContent = '翻译引擎已接入 —— 将按知识库 ' +
          KB.sync.principleCount + ' 条原则与 ' + KB.sync.termCount + ' 条术语翻译';
      } else {
        bar.className = 'rulebar is-warn';
        $('#engineIco').textContent = '⚠️';
        $('#engineText').textContent = '翻译引擎未接入 —— 当前为演示输出（内置示例译文，与上传文件无关）';
      }
    });
  }

  /* ---------------- 启动 ---------------- */
  renderSync();
  renderLists();
  renderLangs();
  renderKB();
  renderEngine();
  renderSteps(0);
  showView('empty');
})();
