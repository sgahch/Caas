# CaaS v2 Windows 离线桌面技术架构

编制日期：2026-10-19。本文供开发 Agent 实施；本轮只编写规划，尚未创建应用、联装依赖或执行 Windows 打包测试。

## 1. 默认架构与范围替换

v2 默认交付 **Electron + Vue 3 + TypeScript + SQLite 的独立 Windows 客户端**，同时交付完整 NSIS 安装包与 portable 免安装包。沿用 Vite、Element Plus、Pinia、Vue Router、ECharts，以及已批准的深蓝 UI、Three.js 真实挤出地图和本地 GeoJSON。桌面窗口承载原八个业务视图，并增加可编辑的本地管理端。

v1 中“默认纯前端、localStorage 为业务持久化、SQLite 仅为可选 P1、默认 VITE_DATA_MODE=demo”的描述由本版替换。v2 默认数据模式为 `desktop`：主进程 DesktopStateService 通过 SqliteStateStore 写 SQLite；渲染端 DesktopRepository 只封装 preload bridge，不持有第二份正式状态。`DemoRepository` 保留为测试及开发适配器，共用 domain；它不与 SQLite 同时维护两份正式状态。原 HTTP 扩展仅保留为未来接缝，本版本无需 Express、localhost 监听端口或常驻服务。

展示主窗口默认打开，保留原调度、暂停、续租等业务操作；配置来自已应用版本。管理入口最多创建一个管理 BrowserWindow，已打开时聚焦复用。它经本地登录编辑单个可恢复草稿，支持预览、保存并应用；不增加审批流或多人协作。关闭管理窗口不退出展示窗口；退出应用统一关闭两个窗口。

## 2. 进程职责与目录

| 层与建议目录 | 职责与边界 |
|---|---|
| `electron/main/windows/` | 窗口、单实例锁、应用生命周期；保存窗口身份及管理会话 |
| `electron/main/ipc/` | 请求来源检查、参数校验、错误映射、提交后通知 |
| `electron/main/db/` | SqliteStateStore、迁移、事务与内部恢复，持久化唯一入口 |
| `electron/main/services/` | DesktopStateService、唯一演示时钟、命令执行、草稿应用、本地账户校验 |
| `electron/preload/` | 展示与管理的受限 bridge，打包为可在 sandbox 内运行的 preload |
| `src/domain/`、`src/shared/` | 原业务纯函数；可序列化契约、校验规则、错误码，不依赖 Electron 或 Vue |
| `src/repositories/` | `DesktopRepository` 适配 bridge；沿用 `CaaSRepository` 的快照、命令、历史接口 |
| `src/views/`、`src/admin/` | 展示及管理页面；Pinia 仅持快照、草稿表单与 UI 状态 |
| `resources/seed/`、`public/maps/` | 随包的初始化数据和地图；本地真实数据库不放这里 |
| `build/`、`docs/` | 图标、打包配置、Windows 验收、版本与数据迁移说明 |

主进程采用一个写入队列、一个权威演示时钟。两窗口的刷新读取同一时间基准，不能各自生成 Token。延续 `demoNow`、`lastMeteredAt` 和关闭期间不补算的规则；重开从保存的演示时刻继续。普通动画仍在 renderer 内执行，不能通过高频 IPC 驱动地图光圈。

启动先获取 `app.requestSingleInstanceLock()`，重复启动聚焦现有展示窗口；正式安装包与 portable 使用稳定一致的应用标识、数据目录和锁策略，并验证交叉启动行为。开发模式使用独立数据目录。主进程每次命令提交即持久化，不能等退出时才保存；Windows 关机并不保证全部退出回调执行。[Electron app](https://www.electronjs.org/docs/latest/api/app)

## 3. 窄 IPC、业务事务与草稿应用

preload 暴露命名明确的方法，例如展示端的 `getSnapshot`、`dispatch`、`getHistory`、`onChanged`，管理端另有登录、读取/保存/预览/应用草稿及备份恢复。`dispatch` 只接受受控的 `DomainCommand` 判别联合；不得暴露原始 `ipcRenderer`、任意 channel、SQL、文件路径读写或 shell 执行。事件订阅返回取消函数，并去掉 Electron event 对象。[Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)、[IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)

建议 preload 输出独立的 `preload.cjs`，将共享校验等必要代码打包进去，不依赖 sandbox 内解析任意 npm 模块。main 与 renderer 可按工具链使用各自模块格式；不要为了 preload 的 ESM 导入失败关闭 sandbox。[Electron ESM](https://www.electronjs.org/docs/latest/tutorial/esm)

所有 handler 在主进程核验来源 webContents、对应主 frame、准确的本地协议与 host，以及该窗口允许的操作。管理授权以主进程会话为准，不能相信请求中的 `isAdmin` 或前端路由。参数按共享 schema 校验类型、枚举、范围和大小；成功或失败返回可序列化结构，错误至少区分无权限、参数无效、资源约束、版本冲突、数据库忙和内部失败。

一次状态命令携带 `requestId`、`expectedBusinessRevision` 及当前 `runId`。主进程按顺序：验证请求→开启写事务→查同代际幂等记录→核对命令指纹与 businessRevision→按旧状态结算计量→执行 domain 校验和所有关联变更→写事件、幂等结果及新 revision→提交。重复的相同请求返回已保存结果，不重复计费；同 requestId 不同内容报错。任何中途失败显式回滚，两个窗口只能在提交之后收到 revision 通知并拉取新快照。[SQLite transactions](https://www.sqlite.org/lang_transaction.html)

管理草稿与已应用配置分开存储。一个可恢复草稿支持保存、隔离预览与保存并应用。纯展示配置和未来遥测参数以白名单 patch 合并，校验 configRevision，不覆盖旧 runtime 快照。节点容量、关联、状态、历史账单和计量基线等结构编辑，必须先进入维护模式，暂停主时钟与冲突业务动作，再建立场景草稿。应用前校验、备份、显示影响并原子切换，生成新 runId；应用后保持暂停，管理员核对后继续。唯一完整协议见 LOCAL_DATA。

版本固定为 configRevision、businessRevision、runtimeRevision 和 runId。runtimeRevision 是整份可展示快照的递增序号，包含配置应用；businessRevision 只在业务约束或实体状态改变时增加，纯计量 tick 不增加。由 tick 触发的到期终止等动作仍属于业务变化。版本矩阵和请求字段以 LOCAL_DATA 第 1.2 节为准，不能继续沿用旧版只用 revision 的实现。

保留 v1 的 X1 无租赁、资源不超分、实例迁移 ID 稳定、UsageRecord 分段、暂停保留资源、未激活订单零账单等不变量。管理配置不能绕过这些规则成为任意写数据库的入口。

## 4. 本地存储、升级与恢复

正式数据默认位于 `app.getPath('userData')/data/caas.sqlite`，备份与日志使用同级专属子目录。Windows 的默认 userData 基于当前用户 AppData；应用名称及标识在升级间保持稳定。数据库不可放安装目录、`app.asar`、`resources` 或 portable 临时解压目录，也不可让两个 renderer 的 localStorage 分别落业务状态。[Electron userData](https://www.electronjs.org/docs/latest/api/app)

默认保存有界的版本化 JSON 领域快照，以复用 v1 的纯函数模型。最小数据组为 app_meta、published_config、scenario_baseline、runtime_state、cms_draft、events、command_results、local_admin、asset_manifest；不按每一个页面复制数据。领域对象之间的引用、资源和计费约束由 domain 完整校验，不能宣称 SQLite 外键会检查 JSON 内部关联。

事件以 events 表为权威，快照中的 events 是查询组装的视图，不重复持久化两份事件；command_results 保存幂等结果。本版是小规模单机演示，默认 SQLite 回滚日志即可，只有实测需求才使用 WAL。参数化 SQL、有限 busy timeout、短事务和单写者仍必须落实。[SQLite WAL](https://www.sqlite.org/wal.html)

区分应用版本、数据库迁移版本、样例版本、配置版本、业务 revision 和数据代际。数据库迁移可用 `PRAGMA user_version` 加迁移记录表；不要直接修改 SQLite 自己使用的 schema_version。首次启动仅在数据库未初始化时建表并事务导入本地 seed；以后启动先检查版本，再顺序执行迁移，不能因 seed 更新覆盖用户编辑。[SQLite user_version](https://www.sqlite.org/pragma.html#pragma_user_version)

升级前生成一致性备份；每个迁移步骤事务化，失败保留旧数据并进入可说明原因的恢复界面，不自动删库重建。遇到来自更高 schema 版本的数据库应停止写入，不猜测降级。重置演示是显式的受限业务操作，数据库升级不能借用重置替代迁移。

数据库升级前的内部回退使用 SQLite 一致备份能力，避免运行中只复制一个 .sqlite 丢失已提交内容。[SQLite Online Backup](https://www.sqlite.org/backup.html) 内部数据库回退文件只用于本机技术恢复，不作为客户跨电脑数据包。用户可见的备份、导入与恢复统一使用 LOCAL_DATA 规定的 .caas.json 内容格式，排除认证数据；不能让导入旧库替换目标机密码。导入后采用新的本机版本和 runId，原有窗口请求失效。

## 5. 离线装载与安全基线

使用自定义本地协议，例如 `caas://app/index.html#/overview`，展示与管理入口均装载随包文件。`registerSchemesAsPrivileged` 在 ready 前注册，开启必要的 standard、secure、supportFetchAPI；ready 后使用稳定的 `protocol.handle`，只映射已打包的 renderer 根目录，校验 host、方法及路径越界，不把数据库目录暴露出去。不要启用 bypassCSP，也不为本项目引入实验性协议 API。[Electron protocol](https://www.electronjs.org/docs/latest/api/protocol)

两个窗口显式配置 `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`、`webSecurity:true`。设置 CSP，脚本只允许本地来源；默认拒绝新窗口、外部导航和无业务需要的权限。不得用关闭隔离或禁用安全检查修复 preload/图片加载问题。本地账户用于防误操作和管理入口控制，密码校验放主进程、存储带盐派生值；该方案不承诺抵抗控制本机账户或拥有管理员权限的人。[Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)

首次启动断网也必须有完整 UI、字体回退、图标、样例数据、SQLite 驱动和地图；不访问 CDN、在线地图、远程字体、许可证服务器或更新服务。开发时可以运行 Vite localhost；正式包不启动 Vite，也不要求客户安装 Node、npm、数据库或浏览器。开发/构建下载 npm 包、Electron 运行时、NSIS 工具与原生预编译件，是制作产物的依赖，不是客户运行时依赖。[electron-builder toolsets](https://www.electron.build/docs/toolsets/)

## 6. 地图与桌面显示继承

复制现有 `assets/maps/china-adm1.geojson`、元数据、manifest 和署名，保留 34 个行政单元及既有 SHA-256 校验。批准图片仅作为视觉参考，不能作为整页背景代替实现。继续支持 Polygon/MultiPolygon、带洞夹具、统一经纬度投影、真实省界、机房光圈、弧线和 HTML 标签；这些与桌面打包无冲突。

窗口缩放、最大化及 Windows 100%/125%/150% 显示缩放下，ResizeObserver、相机视域和 HTML 标签使用同一 CSS 尺寸；DPR 上限先沿用 1.5。最小化时暂停动画，恢复时重绘，卸载时释放 geometry/material/texture/observer。双窗口只在实际地图组件存在时创建 WebGL 场景；不默认关闭硬件加速。保留 1366×768、1440 与 1920 宽度适配目标；性能数据必须在验收机上记录，不能把规划目标写成实测结果。

## 7. Windows 打包与原生 SQLite 风险

使用 electron-builder，Windows target 明确为 x64 的 `nsis` 和 `portable`。NSIS 采用完整离线安装器，不用依赖下载应用包的 `nsis-web`；默认按当前用户安装，不要求管理员权限。固定 productName/appId，创建正常应用入口；升级复用既有数据，卸载默认保留业务数据，清除需明确操作。[NSIS 官方源文档](https://github.com/electron-userland/electron-builder/blob/master/website/docs/nsis.md)

portable 是可复制的单个启动 exe，但运行会解压程序文件，并使用用户数据目录保存编辑结果。“免安装”不能解释为零磁盘写入，移动 exe 也不会自动搬走数据；跨电脑携带编辑内容走显式备份与恢复。两种包均为交付项，不能只提供开发命令或 unpacked 文件夹。[PortableOptions](https://www.electron.build/docs/api/app-builder-lib.interface.portableoptions/)

SQLite 驱动默认选经过联合验证的稳定版 better-sqlite3，仅在 main 使用，并作为生产依赖保留；构建不要把其原生加载路径打散。必须检查 win32-x64 `.node` 及关联资源是否进包、需要真实路径的原生文件是否被正确 ASAR 解包。[Electron ASAR](https://www.electronjs.org/docs/latest/tutorial/asar-archives)

打包步骤记录签名状态与产物校验值；有合法签名凭据时使用正常签名流程，没有时明确交付未签名包，不承诺免系统提示。签名及构建工具需要的联网发生在制作阶段，不作为应用首次启动条件。

注意版本差异：better-sqlite3 官方 v13 发布说明已改用 N-API，并随包提供预编译件；不能笼统声称所有版本都必须针对每个 Electron ABI 重编译，也不能据此承诺任意组合可用。旧 ABI 驱动或不匹配的二进制按目标 Electron/架构使用 `@electron/rebuild` 或所选打包链重建；缺少目标预编译件时需在构建环境准备编译工具。客户机器首次运行绝不能现编译或现下载驱动。[better-sqlite3 releases](https://github.com/WiseLibs/better-sqlite3/releases)、[Electron Native Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules/)

选择仍受维护的 Electron 稳定版及配套包，核对 engines/peerDependencies 后锁精确版本与 lockfile。优先在 Windows x64 机器或 CI 制作并测试 Windows 原生模块和安装包；其他系统能跑 Vite 或输出文件不代表 Windows 已验证。若考虑替换为 Node 内置 SQLite，须核对所选 Electron 实际内嵌 Node 的 API 与稳定性并完成同一验证，不额外维护两套默认数据库实现。

## 8. 第一项实施任务与交付验收

**先完成桌面最小纵向链路再批量编写管理页：**主窗口 + 单管理窗口 → preload 调用 → SQLite 事务写入 → 退出重开读回 → 本地 GeoJSON 地图 → 打出 installer/portable → Windows 断网首次运行。这一关主要排除驱动、资源路径、协议和打包风险。

支持范围约定为 Windows 10 22H2 x64、Windows 11 x64，并记录实际验收版本。Electron 本身为不同操作系统/架构分别提供运行时；同一个 Windows exe 不是 macOS、Linux、ARM64 与 32 位 Windows 的通用交付物。这些平台如需支持要新增对应产物和验证，不能笼统写“全平台兼容”。[Electron Supported Platforms](https://github.com/electron/electron#platform-support)

最终需提供两种 exe、源码及锁文件、构建步骤、依赖版本表、数据位置/备份恢复说明和 SHA-256。Windows 验收至少覆盖：无开发环境且断网的首次启动、安装/portable、编辑应用后跨窗口更新、退出重开、旧版数据升级、备份恢复、受限重置、重复命令不重复写入、冲突不覆盖、非法 IPC 被拒绝、地图及本地素材完整、无业务监听端口。未拿到 Windows 验收环境时如实标记未验证，不能用本规划或 Linux 构建替代证据。

## 9 对外能力与实现约束

生产前端调用受限 bridge，查询接口包括 getSnapshot、getHistory，动作接口为 dispatch，变更订阅为 onChanged。普通业务命令使用 `{ requestId, runId, expectedBusinessRevision, command }`；配置应用使用 `{ requestId, draftBaseConfigRevision, draftId }`，结构应用还必须持有主进程维护会话。主进程按实际修改字段判定应用类别，不信任 renderer 自报。

查询不推进模拟时间；主时钟推进只发生在服务中。前端以更大的 runtimeRevision 接收新完整快照。新 runId 只能由可信主进程的变更通知或成功结果建立；跨恢复、重置和导入都继续增加本机快照序号，不能用导入文件的旧序号回退本机。详细版本及回退规定见 LOCAL_DATA。

保持一份共享显示格式化、UiCopy 和字段映射，避免展示端与后台预览出现不同租金公式。Logo 等客户素材通过独立受限资源路由按资产 ID 提供，只开放清单中已发布或当前管理会话可预览的图片，不把 userData 整个目录映射给页面。图片字段只支持本地受控格式，不接受远程资源 URL。

纯配置和 runtime_state 的读取在同一一致快照中组装；不能先读配置再异步读运行态而合成不同版本。appId、固定数据目录、安装标识与客户可编辑平台名称分离。版本锁定和最后验收必须对应同一源码提交和相同 exe 哈希。
