/* ===========================================================
   export.js —— 译文导出（零依赖）
   -----------------------------------------------------------
   支持三种格式，按钮在结果页选择：
     · docx   Word 文档：保留标题层级、内嵌原图、附术语对照
     · md     Markdown：层级 + 图片链接 + 术语对照，便于二次编辑
     · txt    纯文本：层级用前缀表示，最通用
   图片：原文件里的图（blob:/data: 形式）会被原样内嵌进 docx，
         md 里写成 ![alt](src)，txt 里用「［图片］」占位。
   =========================================================== */
(function () {
  'use strict';

  var enc = new TextEncoder();

  /* ---------- CRC32 + 极简 ZIP（仅 store，不压缩） ---------- */
  function crc32(buf) {
    var table = crc32._t;
    if (!table) {
      table = crc32._t = [];
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) crc = (table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function u16(n) { return [n & 0xff, (n >>> 8) & 0xff]; }
  function u32(n) { return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]; }

  function makeZip(files) {
    var chunks = [], offset = 0, central = [];
    files.forEach(function (f) {
      var nameB = enc.encode(f.name);
      var data = f.data;
      var crc = crc32(data), size = data.length;
      var lh = [].concat(
        u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(size), u32(size), u16(nameB.length), u16(0)
      );
      var lhB = new Uint8Array(lh);
      chunks.push(lhB, nameB, data);
      var ch = [].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(size), u32(size), u16(nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset)
      );
      central.push({ ch: new Uint8Array(ch), name: nameB });
      offset += lhB.length + nameB.length + size;
    });
    var cdStart = offset;
    central.forEach(function (c) { chunks.push(c.ch, c.name); offset += c.ch.length + c.name.length; });
    var eo = [].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(offset - cdStart), u32(cdStart), u16(0));
    chunks.push(new Uint8Array(eo));
    return new Blob(chunks, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  /* ---------- 工具 ---------- */
  function xmlEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function extOf(mime, fallback) {
    var m = {
      'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif',
      'image/bmp': 'bmp', 'image/webp': 'webp', 'image/svg+xml': 'svg',
      'image/x-emf': 'emf', 'image/x-wmf': 'wmf'
    };
    return m[mime] || fallback || 'png';
  }

  /* 取图片字节 + 尺寸。blob:/data: 都能拿到；拿不到就返回 null（图片降级为占位） */
  async function getImg(src) {
    if (!src) return null;
    try {
      var bytes = null, mime = null;
      if (src.indexOf('data:') === 0) {
        var mm = src.match(/^data:([^;]+);base64,(.*)$/s);
        if (!mm) return null;
        mime = mm[1];
        var bin = atob(mm[2]);
        bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else if (src.indexOf('blob:') === 0) {
        var r = await fetch(src);
        var b = await r.blob();
        bytes = new Uint8Array(await b.arrayBuffer());
        mime = b.type || 'image/png';
      } else {
        return null; // http(s)/相对路径：导出环境拿不到，跳过
      }
      var dims = await imgDims(src);
      return { bytes: bytes, mime: mime, ext: extOf(mime, 'png'), w: dims.w, h: dims.h };
    } catch (e) { return null; }
  }

  function imgDims(src) {
    return new Promise(function (res) {
      var im = new Image();
      im.onload = function () { res({ w: im.naturalWidth || 0, h: im.naturalHeight || 0 }); };
      im.onerror = function () { res({ w: 0, h: 0 }); };
      im.src = src;
    });
  }

  function collectTerms(blocks, autoTerms) {
    var KB = window.KB || { terms: [] };
    var text = (blocks || []).map(function (b) { return b.text || ''; }).join('');
    var found = [], seen = {};
    (KB.terms || []).forEach(function (t) {
      if (t && t.name && text.indexOf(t.name) >= 0 && !seen[t.name]) { seen[t.name] = 1; found.push(t); }
    });
    (autoTerms || []).forEach(function (t) {
      if (t && t.name && text.indexOf(t.name) >= 0 && !seen[t.name]) { seen[t.name] = 1; found.push(t); }
    });
    return found;
  }

  /* ---------- Markdown ---------- */
  function buildMarkdown(blocks, meta) {
    var L = [];
    L.push('# ' + (meta && meta.title ? meta.title + ' · 译文' : '译文'));
    if (meta && meta.langPair) L.push('> ' + meta.langPair);
    L.push('');
    (blocks || []).forEach(function (b) {
      if (b.type === 'img') { L.push('![' + xmlEsc((b.img && b.img.alt) || '原图') + '](' + (b.img && b.img.src || '') + ')'); L.push(''); return; }
      if (b.type === 'page') { L.push('---'); L.push('*' + (b.text || '') + '*'); L.push(''); return; }
      if (b.type === 'code') { L.push('```'); L.push(b.text || ''); L.push('```'); L.push(''); return; }
      if (b.type === 'raw') { L.push('> ' + (b.text || '')); L.push(''); return; }
      if (b.type === 'title') { L.push('## ' + (b.text || '')); L.push(''); return; }
      if (b.type === 'h3') { L.push('### ' + (b.text || '')); L.push(''); return; }
      if (b.type === 'li') { L.push('- ' + (b.text || '')); return; }
      if (b.type === 'quote') { L.push('> ' + (b.text || '')); L.push(''); return; }
      if (b.type === 'table') { L.push(b.text || ''); L.push(''); return; }
      var t = b.text || '';
      if (b.miss) t = '【未译】' + t;
      L.push(t); L.push('');
    });
    var terms = collectTerms(blocks, meta && meta.autoTerms);
    if (terms.length) {
      L.push('---'); L.push('## 术语对照'); L.push('');
      terms.forEach(function (t) { L.push('- **' + xmlEsc(t.name) + '** （' + (t.en || '') + (t.gloss ? ' · ' + t.gloss : '') + '）'); });
      L.push('');
    }
    return L.join('\n');
  }

  /* ---------- TXT ---------- */
  function buildTxt(blocks, meta) {
    var L = [];
    L.push((meta && meta.title ? meta.title + ' · 译文' : '译文') + (meta && meta.langPair ? '  （' + meta.langPair + '）' : ''));
    L.push('');
    (blocks || []).forEach(function (b) {
      if (b.type === 'img') { L.push('［图片：' + ((b.img && b.img.alt) || '原图') + '］'); return; }
      if (b.type === 'page') { L.push('──── ' + (b.text || '') + ' ────'); return; }
      if (b.type === 'code') { L.push('    ' + (b.text || '').replace(/\n/g, '\n    ')); return; }
      if (b.type === 'raw') { L.push('（' + (b.keepTag || '保留') + '）' + (b.text || '')); return; }
      if (b.type === 'title') { L.push('【' + (b.text || '') + '】'); return; }
      if (b.type === 'h3') { L.push('■ ' + (b.text || '')); return; }
      if (b.type === 'li') { L.push('• ' + (b.text || '')); return; }
      if (b.type === 'quote') { L.push('“' + (b.text || '') + '”'); return; }
      if (b.type === 'table') { L.push(b.text || ''); return; }
      var t = b.text || '';
      if (b.miss) t = '【未译】' + t;
      L.push(t);
    });
    var terms = collectTerms(blocks, meta && meta.autoTerms);
    if (terms.length) {
      L.push(''); L.push('—— 术语对照 ——');
      terms.forEach(function (t) { L.push(t.name + '：' + (t.en || '') + (t.gloss ? '（' + t.gloss + '）' : '')); });
    }
    return L.join('\n');
  }

  /* ---------- DOCX ---------- */
  function para(text, style) {
    var pPr = style ? '<w:pPr><w:pStyle w:val="' + xmlEsc(style) + '"/></w:pPr>' : '';
    return '<w:p>' + pPr + '<w:r><w:t xml:space="preserve">' + xmlEsc(text) + '</w:t></w:r></w:p>';
  }

  function emu(w, h) {
    var cx = w > 0 ? Math.round(w * 9525) : 5486400;
    var cy = h > 0 ? Math.round(h * 9525) : 4114800;
    /* 可用宽度 = 页宽 11906 twips − 左右边距 1440×2 = 9026 twips（1 twip = 635 EMU）。
       原值 7000000 EMU 超出可用宽度，宽图会溢出页面，故按上面口径收敛。 */
    var maxW = 9026 * 635;   // ≈ 5731510 EMU ≈ 15.9cm
    if (cx > maxW) { cy = Math.round(cy * maxW / cx); cx = maxW; }
    return { cx: cx, cy: cy };
  }

  /* n：图片序号。docPr / cNvPr 的 id 必须逐图递增且互不重复，
     否则多图文档里 id 冲突，Word 会判定内容异常。 */
  function imagePara(rid, w, h, n) {
    var e = emu(w, h);
    var id = (n && n > 0) ? n : 1;
    return '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="' + e.cx + '" cy="' + e.cy + '"/>' +
      '<wp:docPr id="' + id + '" name="img' + id + '"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:nvPicPr><pic:cNvPr id="' + id + '" name="img' + id + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + e.cx + '" cy="' + e.cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }

  async function buildDocx(blocks, meta) {
    var body = [];
    body.push(para((meta && meta.title ? meta.title + ' · 译文' : '译文'), 'Title'));
    if (meta && meta.langPair) body.push(para(meta.langPair, 'Normal'));

    var imgFiles = [], rels = [], n = 0;
    for (var i = 0; i < (blocks || []).length; i++) {
      var b = blocks[i];
      if (b.type === 'img') {
        var im = await getImg(b.img && b.img.src);
        if (im) {
          n++;
          var fname = 'media/image' + n + '.' + im.ext;
          imgFiles.push({ name: 'word/' + fname, data: im.bytes });
          rels.push({ id: 'rId' + n, target: fname });
          body.push(imagePara('rId' + n, im.w, im.h, n));
        } else {
          body.push(para('［图片：' + ((b.img && b.img.alt) || '原图') + '］', 'Normal'));
        }
        continue;
      }
      if (b.type === 'page') { body.push(para('──── ' + (b.text || '') + ' ────', 'Normal')); continue; }
      if (b.type === 'code') { body.push(para(b.text || '', 'Normal')); continue; }
      if (b.type === 'raw') { body.push(para('（' + (b.keepTag || '保留') + '）' + (b.text || ''), 'Normal')); continue; }
      if (b.type === 'title') { body.push(para(b.text || '', 'Heading1')); continue; }
      if (b.type === 'h3') { body.push(para(b.text || '', 'Heading2')); continue; }
      if (b.type === 'li') { body.push(para('• ' + (b.text || ''), 'Normal')); continue; }
      if (b.type === 'quote') { body.push(para('“' + (b.text || '') + '”', 'Normal')); continue; }
      if (b.type === 'table') { body.push(para(b.text || '', 'Normal')); continue; }
      var t = b.text || '';
      if (b.miss) t = '【未译】' + t;
      body.push(para(t, 'Normal'));
    }

    var terms = collectTerms(blocks, meta && meta.autoTerms);
    if (terms.length) {
      body.push(para('术语对照', 'Heading1'));
      terms.forEach(function (t) { body.push(para(t.name + '：' + (t.en || '') + (t.gloss ? '（' + t.gloss + '）' : ''), 'Normal')); });
    }

    var sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
    var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<w:body>' + body.join('') + sect + '</w:body></w:document>';

    var defaults = ['<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="png" ContentType="image/png"/>',
      '<Default Extension="jpeg" ContentType="image/jpeg"/>',
      '<Default Extension="jpg" ContentType="image/jpeg"/>',
      '<Default Extension="gif" ContentType="image/gif"/>',
      '<Default Extension="bmp" ContentType="image/bmp"/>',
      '<Default Extension="webp" ContentType="image/webp"/>'];
    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      defaults.join('') +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>';

    var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>';

    var docRelXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      rels.map(function (r) {
        return '<Relationship Id="' + r.id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' + r.target + '"/>';
      }).join('') + '</Relationships>';

    var files = [
      { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
      { name: '_rels/.rels', data: enc.encode(rootRels) },
      { name: 'word/document.xml', data: enc.encode(documentXml) },
      { name: 'word/_rels/document.xml.rels', data: enc.encode(docRelXml) }
    ];
    imgFiles.forEach(function (f) { files.push(f); });
    return makeZip(files);
  }

  /* ---------- 统一入口 ---------- */
  function filename(base, fmt) {
    var name = String(base || '译文').replace(/\.[^.]+$/, '');
    return name + '_译文.' + (fmt === 'docx' ? 'docx' : fmt === 'md' ? 'md' : 'txt');
  }

  function trigger(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  async function exportResult(fmt, result) {
    var meta = { title: result && result.file && result.file.name, langPair: result && result.langPair };
    meta.autoTerms = result && result.autoTerms;
    var blocks = (result && result.blocks) || [];
    if (fmt === 'md') {
      trigger(new Blob([buildMarkdown(blocks, meta)], { type: 'text/markdown;charset=utf-8' }), filename(meta.title, 'md'));
      return 'markdown';
    }
    if (fmt === 'txt') {
      trigger(new Blob([buildTxt(blocks, meta)], { type: 'text/plain;charset=utf-8' }), filename(meta.title, 'txt'));
      return 'txt';
    }
    // docx
    var blob = await buildDocx(blocks, meta);
    trigger(blob, filename(meta.title, 'docx'));
    return 'docx';
  }

  window.YisuoExport = {
    export: exportResult,
    buildMarkdown: buildMarkdown,
    buildTxt: buildTxt,
    buildDocx: buildDocx
  };
})();
