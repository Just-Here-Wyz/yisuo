/* ===========================================================
   译所 · 核心逻辑自测（零依赖，Node 18+）
   -----------------------------------------------------------
   运行：node test/core.test.js

   覆盖两处：
     ① translator.js —— 整体求值（沙箱注入 window / fetch）
     ② app.js       —— 按函数名从源码抽出纯函数求值
        （app.js 是 IIFE 且启动时依赖 DOM，故不整体加载，
          只取与 DOM 无关的纯逻辑，避免为测试改动源码）

   目的：把「切块 / 编号协议 / 三级解析 / 回声护栏 / 语言判定 /
        无需翻译判定 / 译文清洗 / 抽词 JSON 解析」这些最易回归的
        核心逻辑锁死，改动后一条命令即可验证。
   =========================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ---------------- 迷你断言框架 ---------------- */
let pass = 0, fail = 0, group = '';
function G(name) { group = name; console.log('\n  ▸ ' + name); }
function ok(cond, name) {
  if (cond) { pass++; console.log('    ✓ ' + name); }
  else { fail++; console.log('    ✗ ' + name); }
}
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  ok(a === b, name + (a === b ? '' : `\n        期望 ${b}\n        实际 ${a}`));
}

/* ---------------- ① 载入 translator.js ---------------- */
function loadTranslator() {
  const sandbox = {
    window: {},
    Promise,
    fetch: () => Promise.reject(new Error('测试环境不发起真实请求')),
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(read('translator.js') + '\n;window.Translator;', sandbox);
  return sandbox.window.Translator;
}
const T = loadTranslator();

/* ---------------- ② 从 app.js 抽取纯函数 ---------------- */
/* 从 `function name(` 起做大括号平衡，截到函数体结束 */
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('未找到函数：' + name);
  let depth = 0, opened = false;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    const c = src[i];
    if (c === '{') { depth++; opened = true; }
    else if (c === '}') { depth--; if (opened && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('括号不平衡：' + name);
}

const APP_SRC = read('app.js');
/* keepReason 依赖文件顶部的一组 RE_* 常量，一并带上 */
const RE_BLOCK = (APP_SRC.match(/const RE_URL[\s\S]*?const RE_REFMARK = [^\n]*\n/) || [''])[0];

const APP_FN_SRC = [
  RE_BLOCK,
  extractFn(APP_SRC, 'decodeEnt'),
  extractFn(APP_SRC, 'detectLang'),
  extractFn(APP_SRC, 'keepReason'),
  extractFn(APP_SRC, 'cleanTranslated'),
  extractFn(APP_SRC, 'parseTermJSON'),
  extractFn(APP_SRC, 'blocksToParas')
].join('\n');

const appSandbox = { console };
vm.createContext(appSandbox);
vm.runInContext(APP_FN_SRC + `
;this.API = { decodeEnt, detectLang, keepReason, cleanTranslated, parseTermJSON, blocksToParas };
`, appSandbox);
const A = appSandbox.API;

console.log('\n  译所 · 核心逻辑自测');
console.log('  ────────────────────────────────────────────────────');

/* =========================================================
   A. 切块（splitChunks）
   ========================================================= */
G('切块 · splitChunks');
{
  const few = ['一', '二', '三'];
  eq(T.splitChunks(few).length, 1, '少量段落只切 1 块');

  const many = Array.from({ length: 20 }, (_, i) => '第' + i + '段');
  const chunks = T.splitChunks(many);
  ok(chunks.every((c) => c.length <= 8), '每块段数不超过 8');
  eq(chunks.reduce((s, c) => s + c.length, 0), 20, '切块不丢段（总数守恒）');

  const long = ['x'.repeat(700), 'y'.repeat(700), 'z'.repeat(700), 'w'.repeat(700)];
  const longChunks = T.splitChunks(long);
  eq(longChunks.length, 2, '字符数到顶即切块（4×700 字切成 2 块）');
  ok(longChunks.every((c) => c.length <= 8), '长文本切块同样遵守段数上限');

  eq(T.splitChunks([]).length, 0, '空输入返回空数组');
}

/* =========================================================
   B. 编号解析（extractIndexed / stripFences）
   ========================================================= */
G('编号解析 · extractIndexed');
{
  const raw = '<<<P1>>>第一段\n<<<P2>>>第二段\n<<<P3>>>第三段';
  const got = vm.runInContext(
    '(' + extractFn(read('translator.js'), 'extractIndexed') + ')(' + JSON.stringify(raw) + ')',
    vm.createContext({})
  );
  eq(got[1], '第一段', 'P1 解析正确');
  eq(got[3], '第三段', 'P3 解析正确');
  eq(Object.keys(got).length, 3, '共解析出 3 段');

  const spaced = vm.runInContext(
    '(' + extractFn(read('translator.js'), 'extractIndexed') + ')("<<< P1 >>>甲")',
    vm.createContext({})
  );
  eq(spaced[1], '甲', '编号内空格宽容解析');

  const fenced = vm.runInContext(
    '(' + extractFn(read('translator.js'), 'stripFences') + ')("```\\n<<<P1>>>甲\\n```")',
    vm.createContext({})
  );
  eq(fenced, '<<<P1>>>甲', '剥掉 Markdown 代码围栏');
}

/* =========================================================
   C. 回声护栏（sameAsSource / parseSegments）
   ========================================================= */
G('回声护栏 · sameAsSource / parseSegments');
{
  const tsrc = read('translator.js');
  const LINE_NUM_RE = (tsrc.match(/var LINE_NUM_RE[\s\S]*?;/) || [''])[0];
  const ctx = vm.createContext({});
  vm.runInContext(
    LINE_NUM_RE + '\n' +
    extractFn(tsrc, 'sameAsSource') + '\n' +
    extractFn(read('translator.js'), 'stripFences') + '\n' +
    extractFn(read('translator.js'), 'extractIndexed') + '\n' +
    extractFn(read('translator.js'), 'extractByLineNumber') + '\n' +
    extractFn(read('translator.js'), 'extractByLines') + '\n' +
    extractFn(tsrc, 'covers') + '\n' +
    extractFn(tsrc, 'stripMarks') + '\n' +
    extractFn(tsrc, 'sanitize') + '\n' +
    extractFn(tsrc, 'parseSegments') + '\n' +
    'this.API = { sameAsSource, parseSegments };',
    ctx
  );
  const P = ctx.API;

  ok(P.sameAsSource('Hello  world', 'hello world'), '空白归一后相同 → 判定为回声');
  ok(!P.sameAsSource('你好世界', 'Hello world'), '内容不同 → 不是回声');
  ok(!P.sameAsSource('', 'Hello'), '空候选不判为回声（返回 false）');
  ok(!P.sameAsSource(null, 'Hello'), 'null 候选不判为回声');

  // 正常译文：带编号，覆盖 → 直接采用
  const src1 = { 1: 'The Committee shall report annually.' };
  const good = P.parseSegments('<<<P1>>>委员会应每年提交报告。', [1], src1);
  eq(good[1], '委员会应每年提交报告。', '正常译文按编号解析');

  // 模型照抄原文且带编号 → 必须丢弃（护栏对严格编号一级也生效）
  const echo = P.parseSegments('<<<P1>>>The Committee shall report annually.', [1], src1);
  eq(echo[1], undefined, '带编号的原文回声被丢弃，不冒充译文');

  // 部分回声：第 1 段照抄、第 2 段正常 → 只保留第 2 段
  const src2 = { 1: 'Peak carbon', 2: 'Carbon neutrality' };
  const mixed = P.parseSegments('<<<P1>>>Peak carbon\n<<<P2>>>碳中和', [1, 2], src2);
  eq(mixed[1], undefined, '混合回声：照抄段被丢弃');
  eq(mixed[2], '碳中和', '混合回声：正常译文保留');

  // 无编号，行数恰好对位 → 按行对位
  const byLine = P.parseSegments('第一条译文\n第二条译文', [1, 2], {});
  eq(byLine[1], '第一条译文', '无编号时按行对位（第 1 行）');
  eq(byLine[2], '第二条译文', '无编号时按行对位（第 2 行）');

  // 行首编号宽容解析
  const byNum = P.parseSegments('**P1** 甲\n[P2] 乙', [1, 2], {});
  eq(byNum[1], '甲', '行首 **P1** 宽容解析');
  eq(byNum[2], '乙', '行首 [P2] 宽容解析');
}

/* =========================================================
   D. 语言与 prompt（langName / buildSystem）
   ========================================================= */
G('语言与提示词 · langName / buildSystem');
{
  eq(T.langName('JA'), '日语', 'JA → 日语');
  eq(T.langName('KO'), '韩语', 'KO → 韩语（detectLang 会返回该码）');
  eq(T.langName('ZZ'), 'ZZ', '未登记代码原样返回');

  const sys = T.buildSystem('EN', 'ZH');
  ok(sys.indexOf('【译法原则') >= 0, 'system prompt 含译法原则段');
  ok(sys.indexOf('【术语表') >= 0, 'system prompt 含术语表段');
  ok(sys.indexOf('<<<P1>>>') >= 0, 'system prompt 含编号格式约定');
  ok(sys.indexOf('sk-') < 0, 'system prompt 不含任何密钥片段');
}

/* =========================================================
   E. 语言判定（detectLang）
   ========================================================= */
G('语言判定 · detectLang');
{
  // detectLang 的入参是 blocks 数组
  const bl = (t) => [{ type: 'p', text: t }];
  eq(A.detectLang(bl('The Committee shall report annually to the General Assembly.')).code, 'EN', '英文判为 EN');
  eq(A.detectLang(bl('碳达峰是指二氧化碳排放量达到历史最高值后转入下降阶段。')).isZh, true, '中文判为 isZh');
  eq(A.detectLang(bl('これは日本語のテキストです。漢字も混ざっています。')).code, 'JA', '日文靠假名比例判为 JA');
  eq(A.detectLang(bl('Это текст на русском языке для проверки определения языка.')).code, 'RU', '西里尔判为 RU');
  eq(A.detectLang(bl('이것은 한국어 텍스트입니다. 한글이 포함되어 있습니다.')).code, 'KO', '谚文判为 KO');
  eq(A.detectLang([]).code, 'EN', '空 blocks 回落 EN（不崩）');
}

/* =========================================================
   F. 无需翻译判定（keepReason）
   ========================================================= */
G('无需翻译判定 · keepReason');
{
  eq(A.keepReason('https://example.org/doc?page=2'), '链接', 'URL 判定为链接');
  eq(A.keepReason('contact@example.org'), '链接', '邮箱判定为链接');
  eq(A.keepReason('42'), '数据', '纯数字短串按纯数据判定（RE_PURE 优先）');
  eq(A.keepReason('page 42'), '页码', '「page 42」判定为页码');
  eq(A.keepReason('42 / 100'), null, '「42 / 100」当前不判为保留（RE_PAGE 未覆盖斜杠式页码，属已知边界）');
  eq(A.keepReason('2024  15.6  88.2'), '数据', '纯数据行判定为数据');
  ok(A.keepReason('$E = mc^2$') === '公式' || A.keepReason('$E = mc^2$') === null, '行内 $…$ 公式不误伤普通文本');
  eq(A.keepReason('\\begin{equation} x^2 + y^2 = z^2 \\end{equation}'), '公式', 'LaTeX 环境判定为公式');
  eq(A.keepReason('[1] Smith J. Acoustic metamaterials. JASA 2020;148(3).'), '参考文献', '参考文献条目判定为参考文献');
  eq(A.keepReason('委员会应每年向大会提交报告。'), null, '普通句子不判定为保留');
  eq(A.keepReason('价格是 $100 和 $200 的区别'), null, '$100/$200 不误判为公式');
}

/* =========================================================
   G. 译文清洗（cleanTranslated）
   ========================================================= */
G('译文清洗 · cleanTranslated');
{
  eq(A.cleanTranslated('```\n委员会报告。\n```'), '委员会报告。', '剥掉代码围栏');
  eq(A.cleanTranslated('译文：委员会报告。'), '委员会报告。', '剥掉「译文：」前缀');
  eq(A.cleanTranslated('**委员会报告。**'), '委员会报告。', '剥掉模型加的加粗');
  eq(A.cleanTranslated('3.2 隔振措施'), '3.2 隔振措施', '保留原文真有的编号 3.2');
  eq(A.cleanTranslated('P12: 委员会报告。'), '委员会报告。', '剥掉模型复述的段号 P12:');
  eq(A.cleanTranslated(''), '', '空串不崩');
}

/* =========================================================
   H. 抽词 JSON 解析（parseTermJSON）与实体还原
   ========================================================= */
G('抽词解析 · parseTermJSON / decodeEnt');
{
  const arr = A.parseTermJSON('[{"name":"隔振","en":"vibration isolation"}]');
  eq(arr.length, 1, '标准数组解析出 1 条');
  eq(arr[0].name, '隔振', '术语名正确');

  eq(A.parseTermJSON('```json\n[{"name":"传声损失"}]\n```').length, 1, '带代码围栏也能解析');
  eq(A.parseTermJSON('好的：[{"name":"混响"}]').length, 1, '前后多余文字也能解析');
  eq(A.parseTermJSON('不是 JSON').length, 0, '非法内容返回空数组（不抛错）');

  eq(A.decodeEnt('a &amp; b &lt;c&gt; &#39;d&#39;'), "a & b <c> 'd'", 'HTML 实体正确还原');
}

/* =========================================================
   I. blocks → 段落（blocksToParas）
   ========================================================= */
G('段落还原 · blocksToParas');
{
  const blocks = [
    { type: 'title', text: '第一章' },
    { type: 'h3', text: '1.1 节' },
    { type: 'li', text: '要点一' },
    { type: 'p', text: '正文一段' }
  ];
  const paras = blocksToParasCompat(blocks);
  eq(paras[0], '# 第一章', 'title → # 前缀');
  eq(paras[1], '## 1.1 节', 'h3 → ## 前缀');
  eq(paras[2], '- 要点一', 'li → - 前缀');
  eq(paras[3], '正文一段', 'p → 原样');
}
/* blocksToParas 内部直接读 window.KB，测试里补一个空 KB 即可 */
function blocksToParasCompat(blocks) {
  const ctx = vm.createContext({ window: { KB: { terms: [] } } });
  vm.runInContext(extractFn(APP_SRC, 'blocksToParas') + '\n;this.f = blocksToParas;', ctx);
  return ctx.f(blocks);
}

/* ========================================================= */
console.log('\n  ────────────────────────────────────────────────────');
if (fail === 0) {
  console.log(`  ✓ 全部通过：${pass} 项\n`);
  process.exit(0);
} else {
  console.log(`  ✗ 通过 ${pass} 项，失败 ${fail} 项\n`);
  process.exit(1);
}
