/* ===========================================================
   server/proxy.js —— 本地代理（零依赖，Node 18+）
   -----------------------------------------------------------
   作用：
     1) 静态托管本目录（index.html / styles.css / *.js）
     2) POST /api/translate 转发到大模型，API Key 只留在服务端，
        不随页面下发到浏览器。
   启动：
     set TRANSLATE_PROVIDER=deepseek
     set TRANSLATE_API_KEY=sk-xxxxxx
     node server/proxy.js
   未配置 key 时正常启动，/api/health 返回 translatorReady:false，
   前端自动退回演示模式。
   =========================================================== */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const os = require('os');
const crypto = require('crypto');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8787);

/* ---------------- 使用数据记录（后台采集） ----------------
   仅记录「用户输入原文 + 翻译成功译文 + 时间 + 字符数」，用于运营分析。
   写在云端沙箱的 data/usage.log（JSONL 每行一条）。不记录 IP / 账号。
   你通过 /api/admin/export?token=xxx 把数据下载回本地。
   属个人信息处理，前端已加隐私声明，用户提交即视为同意。 */
const DATA_DIR = path.join(ROOT, 'data');
const USAGE_LOG = path.join(DATA_DIR, 'usage.log');
let _logQueue = Promise.resolve();
function logUsage(srcText, resText) {
  if (!srcText && !resText) return _logQueue;
  _logQueue = _logQueue.then(function () {
    return new Promise(function (resolve) {
      try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const rec = {
          ts: new Date().toISOString(),
          chars: (srcText || '').length,
          src: String(srcText || ''),
          res: String(resText || '')
        };
        fs.appendFile(USAGE_LOG, JSON.stringify(rec) + '\n', function () { resolve(); });
      } catch (e) { resolve(); }
    });
  });
  return _logQueue;
}

/* 启动时外部环境变量的快照。已在外部（命令行/系统）设置过的变量，
   .env 不去覆盖它 —— 外部优先，这是 .env 的通行语义。 */
const EXTERNAL_ENV = Object.assign({}, process.env);

/* 读取本目录 .env。
   每次请求都会重读一次 —— 改完 .env 只需刷新页面，不必重启服务。 */
let envMtime = 0;
function loadEnv(force) {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  let m = 0;
  try { m = fs.statSync(p).mtimeMs; } catch (e) { m = 0; }
  if (!force && m && m === envMtime) return;   // 没变过就不重复解析
  envMtime = m;
  fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach(function (line) {
    const s = line.trim();
    if (!s || s.charAt(0) === '#') return;
    const i = s.indexOf('=');
    if (i < 0) return;
    const k = s.slice(0, i).trim();
    const v = s.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (k && EXTERNAL_ENV[k] === undefined) process.env[k] = v;
  });
}
loadEnv(true);

/* ---------------- 服务商表 ----------------
   全部使用 OpenAI 兼容的 /chat/completions 接口。
   换服务商只需改环境变量 TRANSLATE_PROVIDER，前端代码不动。
   ---------------------------------------- */
const PROVIDERS = {
  /* free 字段为免费档说明（2026-10-08 核实），仅用于启动日志提示，不影响调用 */
  zhipu:       { base: 'https://open.bigmodel.cn/api/paas/v4',               model: 'glm-4-flash',
                 free: 'GLM-4-Flash 永久免费、不限 Token（并发 30）· 国内直连' },
  zhipu5:      { base: 'https://open.bigmodel.cn/api/paas/v4',               model: 'glm-5.3-flash',
                 free: 'GLM-5.3-Flash · 智谱 5.3 系列轻量档',
                 /* glm-5.3-flash 是推理（思考）模型：max_tokens 是「思维链 + 正文」共享额度，
                    且 thinking 不可关闭（仅接受 enabled）。不显式压低思考预算时默认 max，
                    遇到学术长句思维链会吃光 4096 额度导致正文为空 → 界面报「模型返回为空」。
                    故：thinking=enabled + reasoning_effort=low 压缩思维链，maxTokens 给足作兜底。 */
                 reasoning: true, thinkingType: 'enabled', reasoningEffort: 'low', maxTokens: 16384 },
  /* 文字引擎（双引擎方案之「文」）：GLM-4.5-Air，MoE 轻量档，中英双语性价比高。
     同样支持 thinking 开关，这里开启低预算思考以保证译文质量。 */
  zhipu45air: { base: 'https://open.bigmodel.cn/api/paas/v4',               model: 'glm-4.5-air',
                 free: 'GLM-4.5-Air · 中英双语轻量档，性价比高',
                 reasoning: true, thinkingType: 'enabled', reasoningEffort: 'low', maxTokens: 16384 },
  /* 视觉引擎（双引擎方案之「图」）：GLM-4.6V，强 OCR / 文档理解，用于扫描件与图片页翻译。
     非推理模型，不传 thinking；以多模态消息（图文）调用。 */
  zhipu46v:   { base: 'https://open.bigmodel.cn/api/paas/v4',               model: 'glm-4.6v',
                 free: 'GLM-4.6V · 视觉模型，强 OCR / 文档理解',
                 vision: true, reasoning: true, thinkingType: 'enabled', reasoningEffort: 'low', maxTokens: 8192 },
  siliconflow: { base: 'https://api.siliconflow.cn/v1',                      model: 'Qwen/Qwen2.5-7B-Instruct',
                 free: '9B 以下模型永久免费 · 国内直连' },
  groq:        { base: 'https://api.groq.com/openai/v1',                     model: 'llama-3.3-70b-versatile',
                 free: '有免费额度（以官网为准）· 需网络代理' },
  deepseek:    { base: 'https://api.deepseek.com/v1',                        model: 'deepseek-chat' },
  openai:      { base: 'https://api.openai.com/v1',                          model: 'gpt-4o-mini' },
  moonshot:    { base: 'https://api.moonshot.cn/v1',                         model: 'moonshot-v1-32k' },
  dashscope:   { base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',  model: 'qwen-plus' },
  custom:      { base: process.env.TRANSLATE_BASE_URL || '',                 model: process.env.TRANSLATE_MODEL || 'gpt-4o-mini' }
};

function currentProvider() {
  const name = (process.env.TRANSLATE_PROVIDER || '').toLowerCase();
  const p = PROVIDERS[name];
  if (!p) return null;
  return {
    name,
    base: p.base,
    model: process.env.TRANSLATE_MODEL || p.model,
    key: process.env.TRANSLATE_API_KEY || '',
    free: p.free || null,
    reasoning: !!p.reasoning,
    thinkingType: p.thinkingType || null,
    reasoningEffort: p.reasoningEffort || null,
    maxTokens: p.maxTokens || null
  };
}

/* 视觉引擎：读 TRANSLATE_VISION_PROVIDER（默认 zhipu46v）。
   未单独配置时退回文字引擎（仍能工作，只是不走多模态）。 */
function currentVisionProvider() {
  const name = (process.env.TRANSLATE_VISION_PROVIDER || 'zhipu46v').toLowerCase();
  const p = PROVIDERS[name];
  if (!p) return currentProvider();
  return {
    name,
    base: p.base,
    model: p.model,
    key: process.env.TRANSLATE_API_KEY || '',
    free: p.free || null,
    reasoning: !!p.reasoning,
    thinkingType: p.thinkingType || null,
    reasoningEffort: p.reasoningEffort || null,
    maxTokens: p.maxTokens || null,
    vision: !!p.vision
  };
}

/* ---------------- PDF → DOCX 转换（布局保留） ----------------
   没有内置 LibreOffice 时，用 pdf2docx 把 PDF 转成 DOCX，
   让前端走更高保真的 DOCX 解析路径（标题/列表/图片/表格按原结构保留）。
   转换不可用或失败时，前端会自动退回原生 PDF 解析，不影响主流程。
   解释器自动探测：云端用系统 python3（首次自动 pip 安装 pdf2docx），
   本地用 WorkBuddy 托管的 venv；可用 CONVERT_PYTHON 强制指定。 */
const CONVERT_SCRIPT = path.join(__dirname, 'convert.py');
const CONVERT_TIMEOUT = Number(process.env.CONVERT_TIMEOUT || 300000); // 5 分钟上限

// 候选 Python 解释器（按顺序尝试）
function convertPyCandidates() {
  const venv = path.join(os.homedir(), '.workbuddy', 'binaries', 'python', 'envs', 'default', 'Scripts', 'python.exe');
  const list = [];
  if (process.env.CONVERT_PYTHON) list.push(process.env.CONVERT_PYTHON);
  list.push('/usr/bin/python3', '/usr/local/bin/python3', '/opt/python3/bin/python3');
  list.push(venv);
  list.push('python3', 'python');
  return list;
}

// 判断解释器是否可用：路径文件存在，或 PATH 上的裸命令能跑起来
function pyAvailable(py) {
  try {
    if (/[\\/]/.test(py)) return fs.existsSync(py);
    const r = cp.spawnSync(py, ['-c', 'import sys'], { windowsHide: true, timeout: 5000 });
    return !!(r && !r.error && r.status === 0);
  } catch (e) { return false; }
}

/* 确保某解释器已装 pdf2docx。
   首用检查缓存；缺失时自动 pip install（含 PEP 668 的 --break-system-packages 兜底），
   结果缓存，避免每次转换都重装。装不上（无网络/无权限）就记 fail，由上层退回原生解析。 */
const _pyModCache = {}; // py -> true(已装) | false(装不上)
function pyHasModule(py) {
  try {
    const r = cp.spawnSync(py, ['-c', 'import pdf2docx'], { windowsHide: true, timeout: 20000, stdio: ['ignore', 'ignore', 'ignore'] });
    return !!(r && !r.error && r.status === 0);
  } catch (e) { return false; }
}
function pipInstall(py, pkg) {
  return new Promise(function (resolve) {
    let done = false;
    function end(v) { if (!done) { done = true; clearTimeout(to); resolve(v); } }
    const to = setTimeout(function () { end(false); }, 240000); // 4 分钟上限，含 PyMuPDF 等大依赖
    const p1 = cp.spawn(py, ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', pkg], { windowsHide: true });
    p1.on('error', function () { end(false); });
    p1.on('close', function (c1) {
      if (done) return;
      if (c1 === 0) return end(true);
      // 外部受管环境（PEP 668）会拒绝系统级安装，重试带 --break-system-packages
      const p2 = cp.spawn(py, ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '--break-system-packages', pkg], { windowsHide: true });
      p2.on('error', function () { end(false); });
      p2.on('close', function (c2) { end(c2 === 0); });
    });
  });
}
function ensurePdf2docx(py) {
  if (_pyModCache[py] === true) return Promise.resolve(true);
  if (_pyModCache[py] === false) return Promise.resolve(false);
  return Promise.resolve().then(function () {
    if (pyHasModule(py)) { _pyModCache[py] = true; return true; }
    return pipInstall(py, 'pdf2docx').then(function (ok) {
      _pyModCache[py] = ok;
      return ok;
    });
  });
}

function runConvert(pdfBuf) {
  return new Promise((resolve) => {
    if (!fs.existsSync(CONVERT_SCRIPT)) return resolve({ ok: false, error: 'converter script missing' });
    let tmp;
    try { tmp = path.join(ROOT, '.tmp'); fs.mkdirSync(tmp, { recursive: true }); }
    catch (e) { return resolve({ ok: false, error: 'cannot create tmp' }); }

    const id = crypto.randomBytes(8).toString('hex');
    const inFile = path.join(tmp, 'in_' + id + '.pdf');
    const outFile = path.join(tmp, 'out_' + id + '.docx');
    try { fs.writeFileSync(inFile, pdfBuf); }
    catch (e) { return resolve({ ok: false, error: 'write tmp failed' }); }

    const cands = convertPyCandidates().filter(pyAvailable);
    if (!cands.length) return resolve({ ok: false, error: 'no python interpreter found' });

    let idx = 0, settled = false, cur = null, timer = null;
    function finish(ok, payload) {
      if (settled) return; settled = true;
      if (timer) clearTimeout(timer);
      if (cur) { try { cur.kill('SIGKILL'); } catch (e) {} }
      resolve(ok ? { ok: true, file: outFile } : { ok: false, error: payload || 'convert failed' });
    }
    timer = setTimeout(function () { finish(false, 'convert timeout'); }, CONVERT_TIMEOUT);

    function next() {
      if (settled) return;
      if (idx >= cands.length) return finish(false, 'convert failed on all python candidates');
      const py = cands[idx++];
      // 先确认该解释器有 pdf2docx（缺失会自动安装一次），装不上就换下一个
      ensurePdf2docx(py).then(function (ready) {
        if (settled) return;
        if (!ready) return next();
        cur = cp.spawn(py, [CONVERT_SCRIPT, inFile, outFile], { windowsHide: true });
        let errOut = '';
        cur.stderr.on('data', function (d) { errOut += d.toString(); });
        cur.on('error', function () { next(); });
        cur.on('close', function (code) {
          if (settled) return;
          if (code === 0 && fs.existsSync(outFile) && fs.statSync(outFile).size > 0) return finish(true);
          next();
        });
      }).catch(function () { next(); });
    }
    next();
  });
}

/* ---------------- HTTP 小工具 ---------------- */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => {
      buf += c;
      if (buf.length > 4 * 1024 * 1024) { reject(new Error('payload too large')); req.destroy(); }
    });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

function sendJSON(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(s),
    'Cache-Control': 'no-store'
  });
  res.end(s);
}

/* ---------------- 调大模型 ----------------
   images: 可选，图片 data URL 数组（视觉模型用）。存在时以多模态消息调用。 */
async function callLLM(provider, system, user, bodyMaxTokens, timeoutMs = 180000, images) {
  const isReason = !!provider.reasoning;
  /* 推理模型：max_tokens 是「思维链 + 正文」共享额度，必须给足；
     否则思维链一膨胀就把正文额度吃光，content 直接变空串。
     非推理模型：沿用前端给的 maxTokens（默认 4096），不强行放大。 */
  const baseMax = isReason
    ? Math.max(Number(bodyMaxTokens) > 0 ? Number(bodyMaxTokens) : 0, provider.maxTokens || 16384)
    : (Number(bodyMaxTokens) > 0 ? Number(bodyMaxTokens) : 4096);

  // 视觉模型：user 消息改为多模态（文本指令 + 图片）。
  // 4.6v 在 user 文本 part 为空时直接返回空（comp_tokens=0），必须给非空指令兜底。
  const visUser = (images && images.length && (!user || !String(user).trim()))
    ? '请识别并翻译图片里的全部文字，只输出译文，不加解释。'
    : user;
  const userContent = (images && images.length)
    ? [{ type: 'text', text: visUser }].concat(images.map(function (u) {
        return { type: 'image_url', image_url: { url: u } };
      }))
    : user;

  async function attempt(attemptNo) {
    const max_tokens = attemptNo > 1 ? Math.min(baseMax * 2, 131072) : baseMax;
    const body = {
      model: provider.model,
      // 翻译要的是稳定复现术语表与段落格式，不是创造性，温度压到最低
      temperature: 0.1,
      // 明确给足输出长度：不设的话部分厂商默认 1024，长段落会被截断成半截
      max_tokens: max_tokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent }
      ]
    };
    /* 推理模型专属：thinking 只能 enabled（不可关闭），用 reasoning_effort 压低思维链预算，
       把共享的 max_tokens 让给正文，避免正文被挤空。 */
    if (isReason) {
      body.thinking = { type: provider.thinkingType || 'enabled' };
      if (provider.reasoningEffort) body.reasoning_effort = provider.reasoningEffort;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(provider.base.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + provider.key
        },
        body: JSON.stringify(body)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = (j && (j.error && (j.error.message || j.error))) || ('HTTP ' + r.status);
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      }
      const msg = j && j.choices && j.choices[0] && j.choices[0].message;
      let text = msg && msg.content;
      // 视觉模型可能返回数组型 content（文本段混在 parts 里），统一成字符串
      if (Array.isArray(text)) {
        text = text.map(function (p) { return (p && p.type === 'text' && p.text) ? p.text : ''; }).join('');
      }
      /* 推理模型偶发的「思维链占满额度 → 正文为空」：提升额度再试一次，
         而不是把整篇文档判失败。非推理模型正文为空直接报错。 */
      if ((!text || !String(text).trim())) {
        // （原写法含恒真的 `reason || true`，等价于只看 attemptNo，已简化）
        if (isReason && attemptNo < 2) return { retry: true };
        throw new Error('模型返回为空');
      }
      return { text: String(text).trim() };
    } finally {
      clearTimeout(timer);
    }
  }

  const a1 = await attempt(1);
  if (a1.retry) {
    const a2 = await attempt(2);
    if (a2.retry) throw new Error('模型返回为空');
    return a2.text;
  }
  return a1.text;
}

/* ---------------- 静态文件 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',   // ES Module，MIME 不对浏览器会拒绝执行
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.join(ROOT, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

/* ---------------- 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url);
  const p = u.pathname;

  if (p === '/api/health') {
    loadEnv();                     // 热重载：改完 .env 刷新页面即可，无需重启
    const pv = currentProvider();
    return sendJSON(res, 200, {
      ok: true,
      translatorReady: !!(pv && pv.key && pv.base),
      provider: pv ? pv.name : null,
      model: pv ? pv.model : null,
      // 注意：不下发任何 key
      hint: (pv && pv.key) ? '翻译引擎已就绪' : '未配置 API Key，前端将使用演示模式'
    });
  }

  if (p === '/api/translate') {
    if (req.method !== 'POST') return sendJSON(res, 405, { ok: false, error: 'method not allowed' });
    loadEnv();
    let body;
    try {
      body = JSON.parse((await readBody(req)) || '{}');
    } catch (e) {
      return sendJSON(res, 400, { ok: false, error: 'bad json' });
    }
    const system = String(body.system || '');
    const text = String(body.text || '');
    // 视觉翻译：带 images 且显式 useVision → 走视觉引擎（多模态调用）
    const images = Array.isArray(body.images) ? body.images.filter(Boolean) : [];
    const useVision = !!(images.length && body.useVision);
    const pv = useVision ? currentVisionProvider() : currentProvider();

    if (!pv || !pv.key || !pv.base) {
      return sendJSON(res, 200, { ok: false, error: '未配置翻译服务商（TRANSLATE_PROVIDER / TRANSLATE_API_KEY）' });
    }
    if (!text.trim() && !images.length) return sendJSON(res, 400, { ok: false, error: 'empty text' });

    try {
      const out = await callLLM(pv, system, text, body.maxTokens, 180000, useVision ? images : null);
      // 后台采集：文字段记原文/译文；图片段记指令占位 + 译文（便于回溯）
      logUsage(useVision ? ('[图片] ' + text) : text, out);
      return sendJSON(res, 200, { ok: true, text: out, provider: pv.name, model: pv.model, vision: useVision });
    } catch (e) {
      return sendJSON(res, 200, { ok: false, error: String(e && e.message ? e.message : e) });
    }
  }

  if (p === '/api/convert') {
    if (req.method !== 'POST') return sendJSON(res, 405, { ok: false, error: 'method not allowed' });
    loadEnv();
    const chunks = [];
    let size = 0;
    req.on('data', function (c) {
      size += c.length; chunks.push(c);
      if (size > 60 * 1024 * 1024) { req.destroy(); } // 单文件 60MB 上限
    });
    req.on('end', function () {
      const buf = Buffer.concat(chunks);
      if (!buf.length) return sendJSON(res, 400, { ok: false, error: 'empty body' });
      runConvert(buf).then(function (r) {
        if (!r.ok) return sendJSON(res, 200, { ok: false, error: r.error || 'convert failed' });
        try {
          const data = fs.readFileSync(r.file);
          fs.unlinkSync(r.file);
          res.writeHead(200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Content-Length': data.length,
            'Cache-Control': 'no-store'
          });
          res.end(data);
        } catch (e) {
          return sendJSON(res, 200, { ok: false, error: 'read output failed' });
        }
      }).catch(function (e) {
        return sendJSON(res, 200, { ok: false, error: String(e && e.message ? e.message : e) });
      });
    });
    return;
  }

  if (p === '/api/admin/export') {
    loadEnv();
    const qu = url.parse(req.url, true).query || {};
    const adminToken = process.env.ADMIN_TOKEN || '';
    if (!adminToken || String(qu.token || '') !== adminToken) {
      return sendJSON(res, 403, { ok: false, error: '需要管理员口令' });
    }
    let rows = [];
    try {
      if (fs.existsSync(USAGE_LOG)) {
        rows = fs.readFileSync(USAGE_LOG, 'utf8').split(/\r?\n/).filter(Boolean).map(function (l) {
          try { return JSON.parse(l); } catch (e) { return null; }
        }).filter(Boolean);
      }
    } catch (e) {}
    const fmt = String(qu.fmt || 'json').toLowerCase();
    if (fmt === 'csv') {
      const esc = function (s) { return '"' + String(s).replace(/"/g, '""').replace(/\n/g, ' ') + '"'; };
      const body = rows.map(function (r) {
        return [r.ts, r.chars, esc(r.src), esc(r.res)].join(',');
      }).join('\n');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="usage_' + Date.now() + '.csv"'
      });
      return res.end('ts,chars,src,res\n' + body);
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="usage_' + Date.now() + '.json"'
    });
    return res.end(JSON.stringify({ count: rows.length, rows: rows }, null, 2));
  }

  return serveStatic(req, res, p);
});

server.listen(PORT, () => {
  const pv = currentProvider();
  console.log('────────────────────────────────────────');
  console.log('  译所工作台  http://127.0.0.1:' + PORT);
  console.log('  服务商    : ' + (pv ? pv.name : '（未设置 TRANSLATE_PROVIDER）'));
  console.log('  模型      : ' + (pv ? pv.model : '-'));
  console.log('  翻译引擎  : ' + ((pv && pv.key && pv.base) ? '已就绪' : '未配置 → 演示模式'));
  if (pv && pv.free) console.log('  免费档    : ' + pv.free);
  console.log('────────────────────────────────────────');

  /* 后台预热：服务启动即尝试为首个可用解释器装好 pdf2docx，
     这样用户首次上传 PDF 时不必等待安装。失败（无网络/无权限）会被缓存，
     后续自动退回原生 PDF 解析，不影响主流程。 */
  const warmPy = convertPyCandidates().filter(pyAvailable)[0];
  if (warmPy && fs.existsSync(CONVERT_SCRIPT)) {
    ensurePdf2docx(warmPy).then(function (ok) {
      console.log('  [pdf2docx] ' + (ok ? '就绪（' + warmPy + '）' : '不可用，PDF 将退回原生解析'));
    });
  }
});
