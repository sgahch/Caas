# CaaS 算力调度管理平台 2.6.1

Windows 离线桌面平台，沿用 Electron + TypeScript + ECharts + Three.js + SQLite。

本轮新增独立算力租赁数据页、日/周/月/年租金卡片及八张租金图表，总览同步展示租赁收入；增加四款产品目录与租赁规格校验，以及国内外模型 Token 用量排行。保留原有资源监控、地图、业务流程和本地后台。详细计量口径与待报价产品说明见 [租赁与模型用量](docs/RENTAL_ANALYTICS.md)。

- 开发构建：`npm run build`
- 桌面启动：`npx electron .`（先构建）
- 单元与服务验证：`npm test`
- 本轮桌面交互验收：`npm run test:commerce`
- Windows 打包：`npm run dist:win`
- 交付整理：`npm run prepare:delivery`（需要最终 EXE 验收证据）

最终交付在 `delivery/v2.6.1`，使用及验证说明在 `docs`。数据位于 `%APPDATA%\CaaSDesktop`；升级请先退出旧版，保留原数据库。默认资源与计量均为明确标记的本地演示数据。

# CaaS v2.4.3 离线桌面平台

Windows x64 独立客户端，提供八个业务视图、Three.js 中国地图、ECharts 图表、SQLite 保存和本地管理后台。算力、遥测、推理调用和计费数据在本地模拟；品牌与内容编辑、保存、备份和迁移是真实本地功能。

## 交付入口

完整交付包：`delivery/CaaS-v2.4.3-交付包.zip`。解压后打开 `CaaS-Setup-x64.exe` 安装，或直接打开 `CaaS-Portable-x64.exe`；只需选择一种。客户不需要 Node.js、浏览器或数据库服务。

两种形式共用 `%APPDATA%\CaaSDesktop\data\caas.sqlite`。旧版客户端请先正常退出，再打开新版；无需删除旧数据库。首次后台登录自行设置密码，没有通用默认密码。

- `Ctrl+Shift+M`：本地管理后台。
- `Ctrl+Shift+D`：显示或收起操作面板。
- `F11`：全屏。
- 曲线暂停时点击“恢复更新”。顶部为当前北京时间，底部“数据时间”为本地业务时钟。

详见 [快速开始](docs/QUICK_START.md)、[使用说明](docs/USER_GUIDE.md)、[演示步骤](docs/DEMO_GUIDE.md)、[数据格式](docs/DATA_FORMAT.md) 和 [验收记录](docs/VERIFICATION.md)。

## 2.4.3 修复

旧内容包和旧备份在摘要验证后统一转换兼容值，覆盖运行数据、基线与草稿，继续校验容量和引用。修复回归脚本中旧按钮名称及固定版本断言；应用、内容包与界面版本统一读取 package.json。最终安装版和便携版从同一次构建整理，并核对文件哈希及内嵌代码。

2.4.2 的界面文案与当前功能布局保留。旧本地账号、品牌、运行进度和暂停选择继续沿用。旧版内容包可以迁入新版，内容包不携带密码；不承诺把新版数据降级给旧程序。

## 源码构建

开发环境：Windows x64，Node.js 22.19 或兼容的 22.12+ 版本。依赖版本见锁文件与 `docs/dependencies.md`。

```powershell
npm ci
node node_modules/electron/install.js
npm test
npm run build
npm run test:ui
npm run dist:win
```

构建输出为 `release/v2.4.3/`。正式包使用 `caas://app` 加载本地资源，不启动 Vite 或 HTTP 服务。内嵌 Electron 提供 node:sqlite，无需额外 SQLite 驱动。

最终程序回归命令：

```powershell
npm run test:packaged
npm run test:portable
```

包回归通过调试协议在应用代码执行前设置独立 appData，仅写工作区 `.qa`，不会改正式用户目录；产品默认数据身份与认证流程不变。验证证据保存在 `output/playwright/v2.4.3/`。完整发布时，还需按 `scripts/final-package-test.mjs` 的参数对最终安装包解出的客户端运行 `setup` 回归、运行 `scripts/cross-package-test.mjs`，并提供八个历史标准包的兼容结果。旧版包路径通过 `CAAS_LEGACY_PACKAGE` 指定。`npm run prepare:delivery` 会核对这些已执行证据和两种 EXE 内嵌代码，缺少证据时拒绝出包；常规源码构建不需要此步骤。

## 范围与验证

支持目标为 Windows 10 22H2 / Windows 11 x64；本机实测环境为 Windows 11。干净机物理断网首次安装、Windows 10、真实系统 DPI、跨电脑及长时间运行的覆盖范围，以验收记录为准。交付包未签名。

原始规划保存在 `docs/agent-kit-v2/caas-desktop-agent-kit/`，原 Word 文字提取为 `docs/project-plan-docx-extracted.txt`。`serve.mjs` 为历史浏览器工具，客户入口为本次桌面 EXE。
