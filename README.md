# 知页 · AI 图文工作室

面向 AI / GPT 科普与交流账号的图文创作网页。从一个具体选题开始，制作可编辑、可下载的知识卡片。

## 达人带货商务 SOP 与本地工具

新增食品商家商务通用模板：**[下载达人商务工具包](https://github.com/xucong78/11/raw/refs/heads/main/downloads/creator-bd-starter.zip)**。包含 SOP 阅读版、8页 Excel 台账和可本地打开的跟进网页。详细介绍见 [tools/creator-bd](tools/creator-bd/)。不含公司真实数据。

## AI 图文工作室

**Windows 用户：[点击下载免安装版（约 34 MB）](https://github.com/xucong78/11/raw/refs/heads/main/downloads/zhiye-windows-x64.zip)**

下载后完整解压，打开「知页」文件夹，双击 **启动知页.bat**。安装包也可以在本仓库的 [downloads 文件夹](downloads/) 找到；无需安装 Node.js 或 npm。

## Windows 双击使用

面向普通用户的 **Windows 免安装版** 已包含官方 Node.js 运行环境和构建好的网页，适用于 Windows 10 / 11 的 64 位 Intel / AMD 电脑。它不需要用户安装 Node.js、npm 或其他开发工具。

1. 将免安装压缩包**完整解压**，不要在压缩包内部直接运行。
2. 打开「知页」文件夹，双击 **启动知页.bat**。
3. 默认浏览器会打开工作台，使用期间保留启动窗口。
4. 使用完关闭启动窗口。再次双击可重新打开，浏览器中的草稿与作品仍然保留。

启动器只监听本机地址，不会把工作台公开到局域网。已有知页服务运行时会打开原页面，不重复启动；其他软件占用相同端口时会报错，不会关闭它们。

源码版也包含「启动知页.bat」和「启动知页.command」，但源码版需要 Node.js 24.5+；它会按需安装依赖、构建网页并打开浏览器。需要完全免安装体验时请使用 Windows 便携包。

## 已实现

- 选题、目标读者、表达风格与 3 / 5 / 6 / 8 页图文生成。
- 内置 GPT 提问技巧、AI 幻觉、智能体、AI 办公四组本地内容模板；其他选题生成明确标注的可编辑框架。本地模板不会调用 AI，也不会根据风格、读者重新创作文案。连接模型后这些选项参与 AI 生成。
- 接入 OpenAI 兼容模型：可在界面配置 DeepSeek、OpenAI 或兼容服务地址、模型名称和 API Key。模型错误会明确显示，不悄悄回退模板。
- 编辑发布标题、正文、话题，以及每张卡片的小标题、标题、正文和页面类型；新增、删除、调整页面顺序。
- 奶油黄、深墨、淡紫、薄荷四种配色，3:4 和 1:1 画幅，自定义账号署名。
- 单页高清 PNG 下载；全部图文 ZIP 下载，包含原尺寸图片和完整发布文案。
- 草稿自动保存、作品保存、搜索、重新打开和删除。作品存储在当前浏览器，清理网站数据会移除它们，请及时下载留存。
- 适配桌面与手机，提供精选选题库与使用指南。

当前版本专注图文制作，**没有接入抖音登录或自动发布**。图像是知识卡片排版，尚未包含 AI 插画生成。实际外部模型调用需用户提供可用密钥、额度和相应网络访问。

## 本地启动

需要 Node.js **24.5+** 与 npm。首次运行：

```bash
cd /workspace/11
npm ci --cache /workspace/.cache/npm
npm run dev
```

在其他电脑上，将目录替换为下载解压后的项目目录，使用 `npm ci` 即可。开发命令同时启动 Vite 前端（5173）与 Node API（3001）。前端已配置 API 代理，不需要分别启动。

需要自动构建并打开本机网页时，也可以运行 `npm run open`。启动器会从项目位置执行，不要求当前终端正好处于该目录。

## 模型配置

无需密钥即可编辑示例、使用本地模板并下载图文。点击网页右上角「连接 AI 模型」，填写模型服务信息后即可生成其他选题。设置中的密钥仅保存在服务端进程内存中，服务重启后需重新填写；不会写进浏览器存储或接口响应。

如需重启后保留配置，复制 `.env.example` 为 `.env`，填写自己的 `AI_API_KEY`、`AI_BASE_URL` 和 `AI_MODEL` 后重启服务。`.env` 已加入 Git 忽略规则。服务请求继承环境 HTTP/HTTPS 代理与 CA 信任，并保持 TLS 校验。

这是个人单用户工作台；模型设置属于整个服务进程。若要部署成多人可访问的公网服务，需要先添加用户认证、隔离和访问控制。

## 构建和验证

```bash
npm run build
npm test
npm run test:e2e
```

浏览器测试需要安装 Chromium；当前云环境使用 `/usr/bin/chromium`。其他电脑可通过 `CHROMIUM_PATH` 指定浏览器路径，或执行 `npx playwright install chromium` 使用 Playwright 配套浏览器。

E2E 验证需要先运行 `npm run dev`，测试会检查真实 PNG / ZIP 导出、编辑、草稿恢复、作品保存、模板生成、模拟模型调用和手机布局。模拟模型测试不表示已验证外部模型服务。

生产运行：

```bash
npm run build
npm start
```

生产模式由 Node 在 3001 端口同时提供构建后的网页与 API，不需要 Vite 常驻。进程应在新任务中重新启动。

## 打包 Windows 免安装版

```bash
npm run package:windows
```

输出为 `portable/知页-Windows-免安装版.zip`，另附 SHA-256 文件。打包脚本下载固定版本的官方 Node.js Windows x64 压缩包，根据 HTTPS 官方 `SHASUMS256.txt` 验证 SHA-256，并检查程序是 Windows x64 PE 文件；保留 Node.js 许可证。下载或校验失败时会停止打包。运行所需文件只有内置 Node、已构建网页、原生 Node API 与启动器；便携版不携带开发依赖、用户密钥、`.env` 或测试数据。

设置 `ZHIYE_NO_OPEN=1` 可在自动化验证时禁止启动浏览器。可选的 `API_PORT` 调整本机端口。启动器测试验证端口冲突保护、复用服务、无 npm 的便携启动，以及关闭进程清理。Windows 二进制的实际系统兼容性仍需在 Windows 电脑上验证，云端启动验收使用 Linux Node 运行相同便携目录结构。

## 目录

```text
src/                  React + TypeScript 网页
src/components/       固定分辨率知识卡片渲染
src/lib/export.ts     PNG / ZIP 导出
backend/              原生 Node HTTP API、内容模板和模型调用
backend/tests/        API 和内容校验测试
tests/                浏览器端到端测试
```

创作过程不需要数据库。发布前，请核对知识内容中的事实、来源与时效。
