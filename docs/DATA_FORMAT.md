# 内容包与数据库格式

应用版本2.6.1；种子版本2；SQLite schemaVersion 2；backupFormatVersion 1。各版本分别管理。

2.1 的节点增加可选 `telemetryProfile`：`intervalSeconds` 为2～60秒整数，`referenceLoad` 为0～1，`ranges` 含GPU、CPU、显存、内存、存储利用率及温度各自的 `min/base/max`。五项利用率在0～100内，波动温度范围在0～95℃内，必须满足下限≤基准≤上限；无GPU设备的GPU与显存范围为0。旧版无此字段的节点会补齐配置，未调整的默认平直样本会先备份再升级，自定义固定值保留。品牌配置增加可选 `brandName/brandSubtitle`，默认刷新改为3秒。SQLite结构版本和内容包格式版本保持原值；旧版程序不识别3秒配置，跨版本使用前应保留原始内容包。

内容包外层字段为 backupFormatVersion、schemaVersion、appVersion、exportedAt、payload、assetManifest、sha256。payload 包含 config、baseline、state、draft 和 clock。Logo作为受限data URI内容保存，默认地图使用固定版本及SHA-256标识。

2.2边缘节点增加可选字段 `edgeRegion/edgeCity/edgeTenantId/edgeProvisionStatus/edgeLongitude/edgeLatitude/edgeLabelOffsetX/edgeLabelOffsetY`。经纬度必须成对提供且在合法地理范围，0/0表示待定位；标签偏移范围为±300px。归属租户须引用已有租户，接入阶段限待接入、已注册、部署中、已纳管、接入异常。标准EDGE-01～08的旧数据可按编号获得示意位置，未知编号无默认位置；图表从已有节点、任务、实例、Token计量及已出账账单计算，不增加独立汇总表。schema与内容包格式保持兼容。

sha256 为 payload 经 JavaScript `JSON.stringify(payload)` 无缩进序列化后的UTF-8字节摘要。对象键按JSON解析后的JavaScript插入顺序，数组保留原顺序；本格式不允许手工调整字段顺序后继续沿用旧摘要。摘要用于检测意外损坏，不证明来源，也不是加密。

整包限制50 MiB，单图5 MiB且不超过2048×2048。金额以非负安全整数人民币分存储。普通内容恢复不接受数据库文件；账号、密码、盐和会话不属于payload。

SQLite records 表分别保存发布配置、当前基线、运行状态、唯一草稿与元信息。events表为当前事件权威；runtime_state不另存logs。command_results保存同一运行内的请求指纹与幂等记录；local_admin保存随机盐及scrypt派生值。

所有正式写入由 Electron 主进程串行执行；业务与配置在事务提交后广播，2.5 的每秒模拟运行状态在内存更新后广播并定期检查点保存。业务CAS使用businessRevision，配置使用configRevision，完整快照使用runtimeRevision，场景替换生成新runId。计量读取不增加businessRevision。

schema 1→2 在业务窗口打开前用VACUUM INTO创建一致性内部备份，再事务创建迁移记录表并更新user_version。失败保留原库，不静默重建。更高版本拒绝写入。

2.4.3 在验证原始摘要后统一转换旧内容包的策略生效值、遥测模式及预定义文案，覆盖 state、baseline、draft.state 与相应 config。损坏包仍先拒绝；未完成草稿允许保存但不能发布。当前 SQLite schema 与内容包格式保持不变。

## 2.5 兼容扩展

`config.tokenSimulation` 为可选对象：`variable`（布尔），`variation`（0～0.8），`multiplier`（0～100）。旧配置没有该字段时使用自然波动、幅度 0.32、倍率 1，不覆盖各计量表基础 `rate`。

`state.tokenHistory` 为可选、有界的每秒历史，最多 3600 点。每点为 `{time,tokens,seeded?}`；time 为该秒结束时的业务时间，tokens 为该秒输出，seeded 标识预填演示历史。时间严格递增；tokens 为非负安全整数。分钟分桶按 `(time - 1ms)` 归属，00:00:00 结束的一秒计入前一日。

运行计量每秒更新内存与展示广播，约每 5 秒将运行状态及元信息写入单个 SQLite 事务。业务 / 配置修改仍立即保存；休眠与正常退出补保存。时钟使用真实经过的秒数，超过 5 秒的休眠 / 长阻塞不补算。普通查询不推进计量。原有 schema 与内容包版本保持兼容。

## 2.6.1 可选元数据

产品增加 `subtitle`、`rentable`、`gpuModel`、`gpuPerUnit`；报价仍以 `unitPriceCents` 表示每台/每卡的月价（人民币分）。新建命名产品初始月价为零，表示待报价。StarHero X1 的租赁开关必须为 false，类型必须为边缘算力且租金为零。Token 计量增加 `modelName` 和 `modelProvider`，暂停恢复与迁移建立新计量段时保留归属。

租金统计从订单合同分段和生效区间推导，不额外保存一套随机金额或重复收入账本。周期图未来时间为 null。新目录及路由通过 processedDemoEventIds 中的一次性标记升级，首次旧库升级前备份。SQLite schemaVersion、backupFormatVersion 与种子版本保持不变。
