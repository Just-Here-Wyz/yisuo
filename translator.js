/* ===========================================================
   translator.js —— 翻译接入层
   -----------------------------------------------------------
   · 服务商不在本文件里写死：由服务端 server/proxy.js 读环境变量
     TRANSLATE_PROVIDER 决定，换一家只改环境变量，此处无需改动。
   · 未启用代理（key 未配置 / 未启动服务）时 detect() 返回 false，
     前端自动退回演示模式，界面照常可用。
   · 每次翻译前把知识库的译法原则与术语表注入 system prompt，
     这是「运行前读取知识库翻译习惯」的落点。
   =========================================================== */

window.Translator = (function () {
  'use strict';

  var CFG = {
    health: '/api/health',
    translate: '/api/translate',
    chunkChars: 1200,     // 单块字符上限
    maxParas: 8,          // 单块段数上限：号越小模型越不容易漏号
    maxTokens: 4096,      // 明确给足输出长度，避免被默认上限截断
    retry: 2,             // 缺失段补译轮数
    retryParas: 4,        // 补译时每批段数（再小一点，确保一次过）
    splitMark: '<<<SPLIT>>>'
  };

  var _ready = null;      // null=未探测，true/false=已探测结果

  /* ---- 探测代理是否可用 ---- */
  function detect() {
    if (_ready !== null) return Promise.resolve(_ready);
    return fetch(CFG.health, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        _ready = !!(j && j.ok && j.translatorReady);
        return _ready;
      })
      .catch(function () { _ready = false; return false; });
  }

  function resetDetect() { _ready = null; }

  /* ---- 语言代码 → 中文名（用于 prompt） ---- */
  /* 与 app.js detectLang() 的返回码一一对应（含 KO：谚文占比高时判为韩语） */
  var LANG_CN = {
    EN: '英语', JA: '日语', FR: '法语', DE: '德语',
    RU: '俄语', ES: '西班牙语', KO: '韩语', OTHER: '目标语言', ZH: '中文'
  };
  function langName(code) { return LANG_CN[code] || code || '目标语言'; }

  /* ---- 构建 system prompt：注入知识库养成体系 ---- */
  function buildSystem(fromCode, toCode) {
    var KB = window.KB || {};
    var to = langName(toCode);
    var L = [];

    L.push('你是资深文献译者，长于把学术、法律与公文类文本译成自然流畅的' + to + '。');
    L.push('');
    L.push('【译法原则 · 来自使用者的知识库「养成体系」，优先级高于你的默认习惯】');
    (KB.principles || []).forEach(function (p, i) {
      L.push((i + 1) + '. ' + (p.short || p.name) + ' —— ' + (p.desc || ''));
    });
    L.push('');
    L.push('【术语表 · 必须采用表中译法，不得自创或替换】');
    (KB.terms || []).forEach(function (t) {
      L.push('- ' + t.en + ' → ' + t.name + '（' + (t.gloss || '') + '）');
    });
    L.push('');
    L.push('【输入输出格式 · 必须严格遵守】');
    L.push('输入的每一段都带编号标记，形如：');
    L.push('<<<P1>>>第一段原文');
    L.push('<<<P2>>>第二段原文');
    L.push('');
    L.push('你必须按**同样的编号**逐段输出译文，一个编号都不能漏、不能合并、不能新增：');
    L.push('<<<P1>>>第一段译文');
    L.push('<<<P2>>>第二段译文');
    L.push('');
    L.push('【译文要求】');
    L.push('1. 只输出译文本身，不得出现任何解释、前言、后记、译注或 Markdown 代码块围栏。');
    L.push('2. 编号标记 <<<Pn>>> 是格式标记，不是原文内容，不要翻译它、不要改写它。');
    L.push('3. 段首的 # 是标题、## 是小标题、- 是列表项，这些前缀照原样留在译文里。');
    L.push('4. 术语表中的译名必须**一字不差**地采用，不得替换成近义说法。');
    L.push('5. 译文通俗易懂、符合' + to + '表达习惯，宁可稍作意译，也不要生硬直译。');

    return L.join('\n');
  }

  /* ---- 按段落切块：不切断段落；字符数或段数任一到顶就切一块 ----
     段数上限很关键：一块塞 70 个短段时，小模型很容易漏号；
     控制在 8 段以内，漏号率显著下降。 */
  function splitChunks(paragraphs) {
    var chunks = [], cur = [], len = 0;
    paragraphs.forEach(function (p) {
      cur.push(p);
      len += p.length;
      if (len >= CFG.chunkChars || cur.length >= CFG.maxParas) { chunks.push(cur); cur = []; len = 0; }
    });
    if (cur.length) chunks.push(cur);
    return chunks;
  }

  /* ---- 调代理翻译一块（文字引擎） ---- */
  function callChunk(system, text, fromCode, toCode) {
    return fetch(CFG.translate, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: system,
        text: text,
        from: fromCode,
        to: toCode,
        maxTokens: CFG.maxTokens,
        splitMark: CFG.splitMark
      })
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; });
    }).then(function (j) {
      if (!j || !j.ok) throw new Error((j && j.error) || '翻译失败');
      return j.text;
    });
  }

  /* ---- 调代理翻译一张图片（视觉引擎 / 扫描件 OCR） ---- */
  function callChunkVision(system, imgSrc, fromCode, toCode) {
    var instruction = '请识别并翻译这张文档页里的全部文字，从' + langName(fromCode) + '译成' +
      langName(toCode) + '。\n按 <<<P1>>> 输出整页译文，保留原文段落换行；' +
      '只输出译文本身，不要解释、不要前言后记、不要 Markdown 代码块围栏。';
    return fetch(CFG.translate, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: system,
        text: instruction,
        images: [imgSrc],
        useVision: true,
        from: fromCode,
        to: toCode,
        maxTokens: CFG.maxTokens,
        splitMark: CFG.splitMark
      })
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; });
    }).then(function (j) {
      if (!j || !j.ok) throw new Error((j && j.error) || '图片翻译失败');
      return j.text;
    });
  }

  /* 翻译单张图片（扫描页）：返回整页译文字符串，失败抛错 */
  function translateImage(imgSrc, fromCode, toCode) {
    if (!imgSrc) return Promise.reject(new Error('缺少图片数据'));
    var system = buildSystem(fromCode, toCode);
    return callChunkVision(system, imgSrc, fromCode, toCode).then(function (text) {
      var map = extractIndexed(stripFences(text));
      var t = (map[1] && ('' + map[1]).trim()) ? ('' + map[1]).trim() : null;
      if (!t) {
        // 退化：模型没按编号返回时，整段当作译文
        var all = stripFences(text).trim();
        t = all ? all : null;
      }
      return t;
    });
  }

  /* 从模型返回里按 <<<Pn>>> 提取各段；返回 {段号: 内容} */
  function extractIndexed(text) {
    var map = {};
    var re = /<<<\s*P(\d+)\s*>>>([\s\S]*?)(?=<<<\s*P\d+\s*>>>|$)/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var n = parseInt(m[1], 10);
      if (!map[n]) map[n] = String(m[2] || '').trim();
    }
    return map;
  }

  /* 剥掉模型偶尔加的 Markdown 代码围栏 */
  function stripFences(t) {
    return String(t || '')
      .replace(/^\s*(```|~~~)[a-zA-Z]*\s*\r?\n?/, '')
      .replace(/\r?\n?\s*(```|~~~)\s*$/, '')
      .trim();
  }

  /* 候选译文与原文逐字相同（归一化后）→ 视为模型「回声」，不是翻译，必须丢弃。
     这是兜底解析的关键护栏：模型把原文原样吐回来时，绝不能当作译文呈现。 */
  function sameAsSource(cand, src) {
    if (cand == null || src == null) return false;
    var x = String(cand).replace(/\s+/g, ' ').trim().toLowerCase();
    var y = String(src).replace(/\s+/g, ' ').trim().toLowerCase();
    return !!x && x === y;
  }

  /* 行首编号的宽容解析：P1 / [P1] / （P1）/ P1. / **P1** / # P1 都认。
     尾部字符类里带 * 是为了吃掉 **P1** 的后半截星号（否则会残留成「** 甲」）。 */
  var LINE_NUM_RE =
    /^[ \t>*#\-\u3010]*[\[\uff3b\uff08(]?\s*[Pp]\s*(\d+)\s*[\]\uff3d\uff09)]?\s*[.、:：)）\uff0e\-－*]*\s*/;
  function extractByLineNumber(text, expected, srcByWant) {
    var want = {};
    expected.forEach(function (n) { want[n] = true; });
    var map = {}, cur = null, buf = [];
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var m = raw.match(LINE_NUM_RE);
      if (m && want[parseInt(m[1], 10)]) {
        if (cur !== null) map[cur] = buf.join('\n').trim();
        cur = parseInt(m[1], 10);
        buf = [raw.slice(m[0].length)];
      } else if (cur !== null) {
        buf.push(raw);
      }
    });
    if (cur !== null) map[cur] = buf.join('\n').trim();
    /* 护栏：某段与原文逐字相同 → 该段作废（不冒充译文） */
    if (srcByWant) Object.keys(map).forEach(function (k) {
      if (sameAsSource(map[k], srcByWant[k])) delete map[k];
    });
    return map;
  }

  /* 完全没有编号标记时：非空行数恰好等于段数才按行对位。
     对不上就放弃 —— 绝不把整块塞进第一段冒充译文。
     即便对得上，也要逐段核对：内容与原文逐字相同 → 视为回声、丢弃。 */
  function extractByLines(text, expected, srcByWant) {
    var lines = String(text || '').split(/\r?\n/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s; });
    if (lines.length !== expected.length) return {};
    var map = {};
    expected.forEach(function (n, i) {
      if (srcByWant && sameAsSource(lines[i], srcByWant[n])) return; // 原文回声，拒绝
      map[n] = lines[i];
    });
    return map;
  }

  function covers(map, expected) {
    for (var i = 0; i < expected.length; i++) {
      var v = map[expected[i]];
      if (!v || !String(v).trim()) return false;
    }
    return true;
  }

  /* 剥掉段内容里残留的 <<<Pn>>> 标记。
     兜底路径（行对位）拿到的是整行原文，模型若把标记写进了正文，
     不剥掉就会出现「《<<<P1>>>委员会报告》」这种把格式标记当译文的产物。 */
  function stripMarks(s) {
    return String(s == null ? '' : s).replace(/<<<\s*P\d+\s*>>>/g, '').trim();
  }

  /* 归一化一批解析结果：剥残留标记 → 丢弃与原文逐字相同的「回声」段。
     每一级解析后都必须过一遍，否则某一级漏掉的回声会混进最终结果。 */
  function sanitize(map, srcByWant) {
    Object.keys(map).forEach(function (k) {
      map[k] = stripMarks(map[k]);
      if (!map[k]) { delete map[k]; return; }
      if (srcByWant && sameAsSource(map[k], srcByWant[k])) delete map[k];
    });
    return map;
  }

  /* 三级解析：严格编号 → 行首编号 → 行数对位。
     srcByWant：段号 → 原文，用于回声护栏（候选与原文逐字相同则丢弃）。 */
  function parseSegments(raw, expected, srcByWant) {
    var text = stripFences(raw);
    var got = sanitize(extractIndexed(text), srcByWant);
    if (covers(got, expected)) return got;
    var alt = sanitize(extractByLineNumber(text, expected, srcByWant), srcByWant);
    Object.keys(alt).forEach(function (k) { if (!got[k]) got[k] = alt[k]; });
    if (covers(got, expected)) return got;
    var byLine = sanitize(extractByLines(text, expected, srcByWant), srcByWant);
    Object.keys(byLine).forEach(function (k) { if (!got[k]) got[k] = byLine[k]; });
    return got;
  }

  /* ---- 主入口 ----
     paragraphs: 字符串数组（可带 # / ## / - 前缀表示层级）
     onProgress: function(doneCount, totalCount)
     返回 { ok:true, paragraphs:[...], missing:[段号] } —— 缺失的段值为 null，
     **绝不用原文冒充译文**；或 { ok:false, error }
  */
  function translate(paragraphs, fromCode, toCode, onProgress, onError) {
    var system = buildSystem(fromCode, toCode);
    var chunks = splitChunks(paragraphs);
    var out = new Array(paragraphs.length);
    var cursor = 0;   // 全局段号游标
    var firstError = null;
    function noteError(e) {
      if (!firstError) firstError = (e && e.message) || String(e);
      if (onError && typeof onError === 'function') {
        try { onError(firstError); } catch (_) {}
      }
    }

    function report() {
      if (!onProgress) return;
      var done = 0;
      for (var i = 0; i < out.length; i++) if (out[i] != null) done++;
      onProgress(done, paragraphs.length);
    }

    function runChunk(i) {
      if (i >= chunks.length) return Promise.resolve();
      var start = cursor;
      var want = chunks[i].map(function (_, j) { return start + j + 1; });
      var payload = chunks[i].map(function (p, j) {
        return '<<<P' + (start + j + 1) + '>>>' + p;
      }).join('\n');

      return callChunk(system, payload, fromCode, toCode).then(function (text) {
        var srcByWant = {};
        chunks[i].forEach(function (p, j) { srcByWant[start + j + 1] = p; });
        var got = parseSegments(text, want, srcByWant);
        chunks[i].forEach(function (_, j) {
          var v = got[want[j]];
          out[start + j] = (v && ('' + v).trim()) ? ('' + v).trim() : null;
        });
        cursor += chunks[i].length;
        report();
        return runChunk(i + 1);
      }).catch(function (e) {
        /* 单块失败绝不让整篇中断：本块段落标记为缺失，记录首个错误，继续翻后续块。
           这是推理模型偶发「正文为空」时仍能保住 99% 译文的关键护栏。 */
        chunks[i].forEach(function (_, j) { out[start + j] = null; });
        cursor += chunks[i].length;
        noteError(e);
        report();
        return runChunk(i + 1);
      });
    }

    /* 补译：只把缺的段重新发一遍，一次少发几段，号从 1 重新编 */
    function retryRound(idxs, round) {
      if (!idxs.length || round > CFG.retry) return Promise.resolve();
      var batches = [];
      for (var i = 0; i < idxs.length; i += CFG.retryParas) {
        batches.push(idxs.slice(i, i + CFG.retryParas));
      }
      var sys = system +
        '\n\n【补译要求】上一次你没有把全部编号都输出来。这次只译下面这几段，' +
        '必须一段不漏地按 <<<P1>>>…<<<P' + CFG.retryParas + '>>> 输出，不要合并，不要省略。';
      var seq = Promise.resolve();
      batches.forEach(function (batch) {
        seq = seq.then(function () {
          var payload = batch.map(function (gi, j) {
            return '<<<P' + (j + 1) + '>>>' + paragraphs[gi];
          }).join('\n');
          var want = batch.map(function (_, j) { return j + 1; });
          return callChunk(sys, payload, fromCode, toCode).then(function (text) {
            var srcByWant = {};
            batch.forEach(function (gi, j) { srcByWant[j + 1] = paragraphs[gi]; });
            var got = parseSegments(text, want, srcByWant);
            batch.forEach(function (gi, j) {
              var v = got[j + 1];
              if (v && ('' + v).trim()) out[gi] = ('' + v).trim();
            });
            report();
          }).catch(function (e) {
            /* 补译单批失败：保留缺失，下一轮继续补；最终仍缺则记入 missing */
            noteError(e);
            report();
          });
        });
      });
      return seq.then(function () {
        var still = [];
        for (var i = 0; i < out.length; i++) if (out[i] == null) still.push(i);
        return retryRound(still, round + 1);
      });
    }

    return runChunk(0).then(function () {
      var miss = [];
      for (var i = 0; i < out.length; i++) if (out[i] == null) miss.push(i);
      return retryRound(miss, 1).then(function () {
        var missing = [];
        for (var i = 0; i < out.length; i++) if (out[i] == null) missing.push(i + 1);
        report();
        /* ok 恒为 true：个别块失败不再让整篇判失败，缺失段通过 missing 暴露，
           由调用方决定是重试还是人工补译。首个块级错误附在 error 便于提示。 */
        return { ok: true, paragraphs: out, missing: missing, error: firstError || undefined };
      });
    }).catch(function (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    });
  }

  return {
    detect: detect,
    resetDetect: resetDetect,
    translate: translate,
    translateImage: translateImage,
    langName: langName,
    buildSystem: buildSystem,
    splitChunks: splitChunks,
    config: CFG
  };
})();
