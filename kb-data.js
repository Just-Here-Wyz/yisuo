/* ===========================================================
   kb-data.js —— 知识库快照
   内容取自 TEST/wiki/ 中的实际条目（concepts / entities / sources）
   原则名、术语名、来源名均与 wiki 页面一致，未新增未经依据的条目。
   =========================================================== */

window.KB = {
  /* —— 同步元信息 —— */
  sync: {
    time: '23:30',
    date: '2026-10-08',
    principleCount: 4,
    termCount: 40,
    sourceCount: 4,
    pairCount: 152
  },

  /* —— 译法原则（来自 wiki/concepts/） —— */
  principles: [
    {
      name: '法律文本被动语态的汉译',
      short: '被动不译「被」',
      desc: '被动态不译「被」，受事提前、动词紧跟 · 依据 UDHR 官方中英本',
      byUser: false
    },
    {
      name: '长定语的拆分',
      short: '长定语拆分',
      desc: '后置修饰拆成短语／分句，不套长「…的」 · 依据 UDHR 官方中英本',
      byUser: false
    },
    {
      name: '法律公文体句式对等',
      short: '公文体句式对等',
      desc: '长不定式压成文言骨架、shall 类成套措辞 · 依据宪章文言体中英本',
      byUser: false
    },
    {
      name: '虚位 it 保留不省',
      short: '虚位 it 保留',
      desc: 'It\'s because I love her. → 那是因为我爱她。· 用户 10-08 裁定，外部素材另说并存不采用',
      byUser: true
    }
  ],

  /* —— 术语与专名（来自 wiki/entities/） —— */
  /* cat: teal=机构与程序 / purple=法律与制度 / gold=环境与气候 */
  terms: [
    /* 机构与程序 —— 联合国 */
    { name:'大会', en:'General Assembly', cat:'teal', group:'机构与程序 · 联合国',
      gloss:'联合国主要审议机关，由全体会员国组成，一国一票',
      detail:'联合国的主要审议、监督和审查机关，由全体会员国组成，每个会员国享有一个投票权。',
      src:'联合国宪章 第四章 · 官方中文本' },
    { name:'安全理事会', en:'Security Council', cat:'teal', group:'机构与程序 · 联合国',
      gloss:'联合国维护国际和平与安全的主要机关',
      detail:'联合国维护国际和平与安全的主要机关，由 5 个常任理事国与 10 个非常任理事国组成。',
      src:'联合国宪章 第五章 · 官方中文本' },
    { name:'经济及社会理事会', en:'Economic and Social Council', cat:'teal', group:'机构与程序 · 联合国',
      gloss:'负责协调联合国经济与社会工作的机关',
      detail:'负责协调联合国及专门机构的经济与社会工作，就相关国际问题提出建议。',
      src:'联合国宪章 第三章第 7 条 · 官方中文本' },
    { name:'国际法院', en:'International Court of Justice', cat:'teal', group:'机构与程序 · 联合国',
      gloss:'联合国主要司法机关，设于海牙',
      detail:'联合国的主要司法机关，依国际法裁判各国提交的法律争端，并就法律问题发表咨询意见。',
      src:'联合国宪章 第十四章第 92 条 · 官方中文本' },
    { name:'一秉善意', en:'in good faith', cat:'teal', group:'机构与程序 · 联合国',
      gloss:'诚实地履行义务，不规避条约精神',
      detail:'指会员国应诚实地履行其依宪章所担负的义务，不得以规避条约精神的方式行事。',
      src:'联合国宪章 第一章第 2 条第 2 款 · 官方中文本' },
    { name:'国内管辖', en:'domestic jurisdiction', cat:'teal', group:'机构与程序 · 联合国',
      gloss:'一国内部事务，宪章不授权联合国干涉',
      detail:'在本质上属于任何国家内部管辖之事件，宪章不得认为授权联合国干涉。',
      src:'联合国宪章 第一章第 2 条第 7 款 · 官方中文本' },
    { name:'有效集体办法', en:'effective collective measures', cat:'teal', group:'机构与程序 · 联合国',
      gloss:'会员国集体采取的防止与制止措施',
      detail:'指会员国依《宪章》第七章采取的集体行动，含经济制裁与军事措施，用以防止或制止对和平的威胁与破坏。',
      src:'联合国宪章 第一章第 1 条第 1 款 · 官方中文本' },
    { name:'会员国', en:'Member States', cat:'teal', group:'机构与程序 · 联合国',
      gloss:'签署并批准宪章、加入联合国的国家',
      detail:'联合国成员，由签署并批准宪章、经大会接纳的国家构成。',
      src:'联合国宪章 第一章第 2 条 · 官方中文本' },
    { name:'秘书长', en:'Secretary-General', cat:'teal', group:'机构与程序 · 联合国',
      gloss:'秘书处的行政首长，联合国最高行政负责人',
      detail:'秘书处的行政首长，由大会经安全理事会推荐后任命，为联合国的首席行政官员。',
      src:'联合国宪章 第十五章第 97 条 · 官方中文本' },

    /* 法律与制度 */
    { name:'执行办法', en:'enforcement measures', cat:'purple', group:'法律与制度 · 宪章',
      gloss:'安全理事会为维持或恢复和平所采取的强制措施',
      detail:'安全理事会为维持或恢复国际和平与安全所采取的强制性措施，在宪章第七章下授权实施。',
      src:'联合国宪章 第一章第 2 条第 7 款 · 官方中文本' },
    { name:'国际托管制度', en:'international trusteeship system', cat:'purple', group:'法律与制度 · 宪章',
      gloss:'对非自治领土实行国际监督管理的制度',
      detail:'联合国为管理和监督尚未自治之领土所设的制度，规定于宪章第十二章。',
      src:'联合国宪章 第十二章标题 · 官方中文本' },
    { name:'非自治领土', en:'Non-Self-Governing Territories', cat:'purple', group:'法律与制度 · 宪章',
      gloss:'尚未达成完全自治、由管理国负责的领土',
      detail:'指其人民尚未臻自治充分程度之领土，管理国负有促进其自治与福祉的义务。',
      src:'联合国宪章 第十一章标题 · 官方中文本' },
    { name:'批准及签字', en:'ratification and signature', cat:'purple', group:'法律与制度 · 宪章',
      gloss:'条约生效前的签署与批准程序',
      detail:'宪章生效前须经签署国各依其宪法程序予以批准，批准书交存后生效。',
      src:'联合国宪章 第十九章标题 · 官方中文本' },

    /* 环境与气候 */
    { name:'碳达峰', en:'peak carbon dioxide emissions', cat:'gold', group:'环境与气候 · 双碳',
      gloss:'二氧化碳排放量达到历史最高值后转入下降',
      detail:'指二氧化碳排放量达到历史最高值，此后进入逐步下降的阶段；题名作 Carbon Peaking。',
      src:'碳达峰碳中和的中国行动白皮书 前言 · 官方英文本' },
    { name:'碳中和', en:'carbon neutrality', cat:'gold', group:'环境与气候 · 双碳',
      gloss:'人为排放与人为吸收相抵，实现净零排放',
      detail:'在一定时期内，通过植树造林、节能减排等方式抵消自身产生的二氧化碳排放，实现净零排放。',
      src:'碳达峰碳中和的中国行动白皮书 前言 · 官方英文本' },
    { name:'国家自主贡献', en:'Nationally Determined Contributions (NDCs)', cat:'gold', group:'环境与气候 · 双碳',
      gloss:'《巴黎协定》下各缔约方自主提出的气候行动目标',
      detail:'《巴黎协定》下各缔约方自主提出的气候行动目标，涵盖减排、适应与资金等承诺。',
      src:'碳达峰碳中和的中国行动白皮书 前言 · 官方英文本' },
    { name:'绿水青山就是金山银山', en:'lucid waters and lush mountains are invaluable assets', cat:'gold', group:'环境与气候 · 双碳',
      gloss:'良好生态环境本身就是宝贵财富',
      detail:'阐述生态环境保护与经济发展相统一的理念；英文本处理为一则 the principle that… 从句。',
      src:'碳达峰碳中和的中国行动白皮书 前言 · 官方英文本' },

    /* 声学 · GB/T 3947（验证中发现的偏差，补为标准词，防止再犯） */
    { name:'隔振', en:'vibration isolation', cat:'purple', group:'声学 · GB/T 3947',
      gloss:'隔绝振动传递的措施，使振源与受振体解耦',
      detail:'GB/T 3947 标准词。模型曾译为「振动隔离」，意思正确但非标准术语，统一收口为「隔振」。',
      src:'GB/T 3947-1996 声学名词（全国声学标准化技术委员会，公开标准）' },
    { name:'传声损失', en:'transmission loss', cat:'purple', group:'声学 · GB/T 3947',
      gloss:'声波透过构件时声功率的损耗量，常用分贝表示',
      detail:'GB/T 3947 标准词，亦称「隔声量 / 透射损失」。模型曾译为「传输损耗」，意思偏差，统一收口为「传声损失」。',
      src:'GB/T 3947-1996 声学名词（全国声学标准化技术委员会，公开标准）' }
  ],

  /* —— 来源文献（来自 wiki/sources/） —— */
  sources: [
    { ico:'📄', text:'世界人权宣言 · 1948 · 联合国官方中英本' },
    { ico:'📜', text:'联合国宪章 · 1945 · 五种文字同作准' },
    { ico:'🌱', text:'碳达峰碳中和的中国行动白皮书 · 2025' },
    { ico:'🧩', text:'Tatoeba 句对库 · CC BY 2.0 FR' }
  ],

  /* —— 最近更新（来自 logs.md） —— */
  updates: [
    '10-08 23:30 · 声学验证对照 GB/T 3947：补「隔振 / 传声损失」2 条标准术语，防再犯',
    '10-08 20:48 · 用户裁定「虚位 it 保留不省」，原则页状态改为「成型」',
    '10-08 20:12 · 补给 4 篇素材，新增 4 条原则、2 组术语',
    '10-07 · 建立仓库骨架与巡检机制'
  ],

  /* 说明：本文件只提供「养成的译法」—— 原则与术语，供翻译时注入。
     抓取来的文献原文一概不进这里，也不作为译文的兜底内容：
     它们只是提炼习惯的素材，成品界面上不出现。 */

  /* —— 最近任务 / 队列 —— */
  /* 任务列表不再预置任何文献名 —— 改由运行时记录「用户亲手拖入的文件」，
     见 app.js 的 TASKS。此处保留空数组仅为兼容旧引用。 */
  recent: [],
  queue: [],

  /* —— 输出语言选项 —— */
  languages: [
    { flag:'🇬🇧', name:'English',   code:'EN' },
    { flag:'🇯🇵', name:'日本語',      code:'JA' },
    { flag:'🇫🇷', name:'Français',  code:'FR' },
    { flag:'🇩🇪', name:'Deutsch',   code:'DE' },
    { flag:'🇷🇺', name:'Русский',   code:'RU' },
    { flag:'🇪🇸', name:'Español',   code:'ES' },
    { flag:'🌍', name:'其他语言…',    code:'OTHER' }
  ]
};
