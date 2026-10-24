# 第三方组件声明

## pdf.js（PDF 文本解析）

| 项 | 内容 |
|---|---|
| 组件 | pdf.js（pdfjs-dist） |
| 版本 | 4.10.38 |
| 作者 | Mozilla Foundation |
| 许可 | Apache License 2.0 |
| 官方仓库 | https://github.com/mozilla/pdf.js |
| 许可全文 | https://www.apache.org/licenses/LICENSE-2.0 |
| 获取渠道 | https://registry.npmmirror.com/pdfjs-dist/4.10.38/files/legacy/build/ |

文件（**legacy 构建**，见下方说明）：
- `pdf.min.mjs` —— 主库（ES Module）
- `pdf.worker.min.mjs` —— 解析 Worker

> **为什么用 legacy 构建**：标准版 pdf.js 4.x 在模块初始化时调用 `Promise.withResolvers()`（ES2024 新 API），旧内核浏览器（如部分手机内置 WebView / 微信浏览器，Chrome < 119、Safari < 17.4）会直接抛 `Promise.withResolvers is not a function`，导致 PDF 组件整个加载失败。legacy 构建经 core-js 转译并内置该 API 的垫片，可兼容旧浏览器。

用途：在浏览器本地解析 PDF 并提取文本层，**不上传、不外发**。

限制：
- 只能提取**文本层**；扫描件／图片型 PDF 无文本层，提取结果为空，需要 OCR，当前不支持。
- 标题层级的判断依据是字号，对排版特殊的 PDF 可能不准。
