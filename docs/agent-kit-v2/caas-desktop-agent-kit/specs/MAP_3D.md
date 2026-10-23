# CaaS 桌面版 3D 地图实施规格

版本 v2.0。保留已批准的 3D 视觉及本地资产；本章规格用于 Electron 展示窗口。主进程持久化、窗口与资源协议按 ARCHITECTURE 执行。下面的页面参数是实现起点，性能需在最终 Windows 包验证。

## 1. 默认本地地图来源：已核实的 geoBoundaries gbOpen

### 1.1 可直接执行的来源

默认使用 geoBoundaries 官方 `gbOpen/CHN/ADM1`，不是临时抓取无法追溯的 JSON。官方说明 gbOpen 符合 CC BY 4.0 使用条件并要求署名；具体 CHN/ADM1 元数据还标明原始边界许可证为 Public Domain。这两层信息都应记录，不要只保留“网上下载”。[官方 API 文档](https://www.geoboundaries.org/api.html)

已打开并核实的元数据地址：

`https://www.geoboundaries.org/api/current/gbOpen/CHN/ADM1/`

本次返回内容：

| 字段 | 已核实值 |
|---|---|
| `boundaryID` | `CHN-ADM1-43563684` |
| `boundaryISO` / `boundaryType` | `CHN` / `ADM1` |
| `boundaryYearRepresented` | `2019` |
| `boundarySource` | `geoBoundaries, Wikimedia Commons` |
| `boundaryLicense` | `Public Domain` |
| `admUnitCount` | `34` |
| `buildDate` | `Dec 12, 2023` |
| 下载路径中固定的 commit | `9469f09` |

元数据实际提供的下载 URL：

- 完整 GeoJSON：`https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/CHN/ADM1/geoBoundaries-CHN-ADM1.geojson`
- 简化 GeoJSON：`https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/CHN/ADM1/geoBoundaries-CHN-ADM1_simplified.geojson`

上面两个下载地址来自官方 API 响应。简化 GeoJSON 已下载并随执行资料包提供，因此正常实现不依赖临时联网下载；只有确有几何精度问题时才考虑通过 `gjDownloadURL` 更换，并保留来源记录。不要自行拼接猜测下载地址。[CHN/ADM1 元数据](https://www.geoboundaries.org/api/current/gbOpen/CHN/ADM1/)

### 1.2 落地文件与检查

执行资料包已经包含以下相对路径，可直接复制到应用的 `public/maps/` 并保持来源文件：

- `assets/maps/china-adm1.geojson`
- `assets/maps/source-metadata.json`
- `assets/maps/asset-manifest.json`
- 批准的视觉参考：`reference/ui-approved.png`

已读文件核实：GeoJSON 为 FeatureCollection，34 个 feature，263,343 字节，其中 28 个 Polygon、6 个 MultiPolygon，共 48 个多边形；本底图没有内部洞，洞适配用独立小夹具验证；SHA-256 为 `bc4afc7eacf4351ae5b3ae7a612327987ce1123cb5deb8574fb49107091c6623`。实际属性包含 `shapeName`、`shapeISO`、`shapeID`、`shapeGroup`、`shapeType`，例如第一个 feature 的 shapeName 是 Hainan Province；行政单元稳定键使用 `shapeID`，不要误把示例中值为 CHN 的 `shapeISO` 当成省级唯一编码。

来源文件中保留来源 URL、下载时间、boundaryID、commit、文件 SHA-256、原始许可证；实施中如果归一化或简化，再补记处理动作和坐标系检查结果。`docs/ASSET_SOURCES.md` 写清地图署名及处理动作；地图角落提供简洁的 geoBoundaries 来源入口，离线包同带署名文本。

素材处理任务必须检查 JSON 类型、非空 features、Polygon/MultiPolygon、经纬度范围、行政单元数量与名称映射。对实际 feature 属性做一次适配，不假定第三方字段一定叫 `name` 或 `adcode`。地图标签中文名称来自项目自己的受控映射，省份名称不从模型临时生成。

这是本项目的演示底图来源，不能标为 2026 年实时行政区划。机房、X1 点位来自样例业务数据，未提供真实地址的机房采用标明性质的演示位置；不要把“内蒙古机房”擅自表述为已确认位于某个城市。边缘站点可以展示若干示意节点或一个区域集合，不能暗示用户确实在那些精确坐标部署了设备。

DataV 官方选择器目前写有“仅供学习交流使用”，因此不作为本方案默认可随交付打包的数据来源。若客户提供已有授权数据，可替换 GeoJSON 而保留相同渲染接口。[DataV 官方页面](https://datav.aliyun.com/portal/school/atlas/area_selector?lt=)

## 2. 3D 地图逐项实施任务

### M1：投影与几何适配器

文件：`engine/geoProjection.ts`、`engine/geoJsonToShapes.ts`。

1. GeoJSON 的位置按 `[longitude, latitude]` 读取，不把纬度放在前面。采用 `d3-geo` 的 Mercator 投影，统一从经纬度转为平面坐标，再把平面坐标归一化到约 100 个世界单位宽。现代 GeoJSON 标准使用 WGS84、角度单位；若输入旧式数据另声明坐标系，先处理再使用，不混入 GCJ-02 点位。[RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946)、[D3 Projection](https://d3js.org/d3-geo/projection)
2. 推荐逐点投影后计算平面顶点 bounds，得到统一 scale 和 offset，避免未经处理就对任意环绕序的数据调用球面 `fitExtent`。D3 球面多边形绕序与常见 GeoJSON 约定存在区别；如果改用 `fitExtent`/`geoPath`，必须先按 D3 约定处理源数据副本，不得改坏原始资产。[D3 Geo](https://d3js.org/d3-geo)
3. 全项目只有一个 `geoToWorld(lon, lat, elevation)`：x 向东，y 向北，z 为高度。D3 的屏幕 y 向下，应统一取反。地图顶点、机房点、弧线端点和标签 anchor 全部调用此函数，禁止分别写百分比定位。
4. Polygon：第一环生成外轮廓，后续每个环生成 `Path` 并加入 `shape.holes`。MultiPolygon：遍历每一个 Polygon，每个分别处理其外环和洞；不要只读 `coordinates[0][0]` 丢掉岛屿、多面和洞。
5. 清除重复闭合点及相邻重复点，检查每环至少三个非共线独立点。投影后用有符号面积规范化绕序，保证洞与外环方向相反。Three.js 官方 Shape 明确要求洞与外环反向。[Three.js Shape](https://threejs.org/docs/pages/Shape.html)
6. 每个行政单元保留自己的稳定 ID、名称映射和多面集合。不要为省份手绘方块，也不要按照 AI 参考图的错误轮廓重画中国。

完成证据：一个带洞测试多边形的洞保持空白；一个含两个分离多面的测试 feature 两部分均出现；中国全部导入单元可见且没有覆盖整屏的翻面多边形。

### M2：场景、挤出与边界

文件：`engine/createScene.ts`、`engine/buildProvinceMeshes.ts`、`engine/buildBorders.ts`。

- 使用 `WebGLRenderer({ antialias: true, alpha: true })`。场景采用正交相机与固定倾斜俯视角，使画面接近批准的科技大屏效果。以实际 3D bounds 计算相机视域和 padding，不把相机位置与某一分辨率硬绑定。
- `ExtrudeGeometry` 初始采用 `depth` 约 1.5～2.5 世界单位、`steps: 1`、`bevelEnabled: false`，先确保形状准确和性能，再微调厚度。顶面为深青蓝，侧面更暗，边界用青色高光，保留可见的立体侧壁。[Three.js ExtrudeGeometry](https://threejs.org/docs/pages/ExtrudeGeometry.html)
- 省界使用实际 ring 顶点生成 LineSegments，位于顶面稍上方以避开 z-fighting；共享边段可按坐标量化键去重。不要用 EdgesGeometry 输出所有三角剖分边，造成网格三角线铺满地图。
- 用半透明底座、少量灯光和本地程序纹理营造层次。首版 不要求泛光后处理；可先用叠加线条、透明光圈和 CSS 面板光晕达成效果，避免全屏 bloom 压低帧率。
- 省份颜色、高亮和 hover 通过材质变化实现，业务数据刷新时不重新生成整张 ExtrudeGeometry。

完成证据：整体轮廓与来源一致、省界清楚、地图有真实厚度；不是 flat SVG 加倾斜 CSS，也不是一张截图。

### M3：点位、光圈与调度弧线

文件：`engine/buildMarkers.ts`、`engine/buildRoutes.ts`。

- 三个中心机房使用一致的点位符号，X1 边缘节点使用尺寸或形状不同的符号。颜色遵循全局状态字典：在线绿色、空闲蓝色、异常/离线红色、警告橙色，同时配文字，不能只靠颜色表达状态。
- 每个可见点最多两个低面数光圈，使用共享 geometry/material，在动画中改变 scale/opacity；不要每帧重新创建 RingGeometry 或贴图。
- 弧线使用 `QuadraticBezierCurve3`，起点/终点来自同一 `geoToWorld`。控制点为两端中点加适量 z 高度；保留 3～6 条有业务意义的路线，沿曲线移动少量亮点即可。线条表示演示任务流向，不展示为真实网络链路测量。[Three.js QuadraticBezierCurve3](https://threejs.org/docs/pages/QuadraticBezierCurve3.html)
- 默认固定相机，避免不必要的自由旋转导致地图翻转或标签被挡。可选轻微视角调整必须限制角度，并提供复位；未经需要不加 OrbitControls。
- 点位或 HTML 标签点击发出机房 ID，联动首页节点表筛选。场景演示切换时更新路线状态，普通 30 秒指标刷新不重建地图。

完成证据：所有点位在正确行政区域，机房切换可过滤表格；路线起止与对应点重合，动作触发后路线状态合理。

### M4：HTML 标签与 WebGL 同步

文件：`MapLabels.vue`、`engine/projectLabels.ts`。

- 中文名称和统计数字使用真实 HTML，保持字体清晰、可复制且容易布局，不烘焙进贴图。机房标签初始只显示名称和最重要的一至两个数值；更多信息放 hover 卡片。
- 标签 anchor 保存世界坐标或绑定对应 Object3D。需要更新时先更新 scene/camera matrices，再以 `Vector3.project(camera)` 得到 NDC，并根据地图容器的 CSS 像素宽高转换为屏幕坐标。像素公式使用 CSS 尺寸，不能使用已经乘 DPR 的 canvas backing size。[Three.js Vector3](https://threejs.org/docs/pages/Vector3.html)
- HTML overlay 与 canvas 使用同一个定位父容器。只允许对投影结果增加小的标签避让偏移；避让线仍回到真实 anchor。不要为南宁、成都等分别写死 `left: 35%` 之类值。
- 在 resize、相机变化、map group transform 和标签内容尺寸变化后更新标签。固定相机时不必让 Vue 每帧响应全部坐标；可由单一渲染循环直接更新少量元素的 transform。
- 标签隐藏逻辑处理画布外、相机后方及异常坐标。HTML overlay 默认 `pointer-events: none`，标签按钮单独开启点击，避免透明 overlay 阻挡整个地图。

完成证据：1366、1440、1920 宽度下标签跟随点位，客户端缩放和 Windows 显示缩放及折叠侧栏后仍对齐，没有数字和城市名漂移。

### M5：生命周期、动画与重绘

文件：`engine/renderLoop.ts`、`engine/disposeScene.ts`。

- 一个地图实例只保留一个动画调度源：使用 `renderer.setAnimationLoop` 或自行封装的单一 requestAnimationFrame，不能两者一起运行。帧时间用于插值，视觉动画与 10/30/60 秒业务刷新独立。
- 通过 ResizeObserver 观察容器；尺寸为零时不创建 renderer。resize 时更新 renderer 大小、相机投影矩阵、可选宽线材质 resolution、ECharts 尺寸和标签，不重建地理数据。
- `pixelRatio = Math.min(devicePixelRatio, 1.5)` 作为默认性能配置，可按验证结果调整。document hidden、页面失活或地图不可见时暂停动画，重新显示时恢复；按真实可见帧时间推进，避免恢复后一瞬间跑完大量补帧。
- 卸载时停止循环，取消未完成 rAF，断开 ResizeObserver/IntersectionObserver，移除所有事件监听和 HTML 节点，释放 geometry、material、texture、render target、controls 及 renderer。共享资源用 Set 去重释放；Three 对象使用 `markRaw`/普通模块对象，避免放入深层响应式状态。
- 处理 `webglcontextlost`：显示明确的地图加载故障与重试入口，防止页面假死。调低特效可作为恢复措施，但 WebGL 不可用时的文字占位不能视作“3D 地图已通过验收”。

Three.js 官方说明 GPU 资源需要显式清理；响应式渲染也需要匹配 canvas 尺寸与相机。[WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer)、[Cleanup](https://threejs.org/manual/pages/cleanup.html)、[Responsive Design](https://threejs.org/manual/pages/responsive.html)

## 3. 二维图表、样式与响应式要求

ECharts 使用 `echarts/core` 加实际需要的图表和组件，封装一次 init、setOption、resize、dispose。总览资源水位和实例近一小时曲线使用同一套深色主题；表格不使用 canvas 绘制。切换路由、关闭详情抽屉时释放图表实例，重新打开时在非零容器上初始化。[ECharts Import](https://echarts.apache.org/handbook/en/basics/import/)、[ECharts Chart Size](https://echarts.apache.org/handbook/en/concepts/chart-size/)

批准图片用于复刻视觉方向：深蓝背景、青蓝边线、卡片层次、半透明面板、3D 中国地图、点位光圈和细弧线。必须换成真实中文、正确字段、统一金额与单位。图片中的错误地理轮廓、错位文字、任意业务数值、水印不进入产品；精确逐像素复刻不属于验收口径。

样式先定义 tokens：背景、面板、边界、文字、弱文字、品牌青、状态色、圆角、间距、阴影。先覆盖 Element Plus 暗色 CSS 变量，再少量针对组件调整，不依赖满页 `!important`。不从在线 CDN 加字体、图标或 CSS。

电脑端目标为 1920×1080、1440×900、1366×768。使用正常 CSS Grid/Flex 布局；不要将整页固定为 1920 像素再 `transform: scale()`，避免字体过小和鼠标命中偏移。主地图容器建议 320～480px 高，根据可用空间调整，侧栏可折叠；小屏时允许指标卡换行、页面向下滚动、宽表格在自身容器横向滚动，不压扁地图、不裁剪必须信息。


## 4 桌面适配与生命周期

- 展示窗口进入全屏、还原、跨屏移动和系统 DPI 改变时重新测量容器并更新相机与标签。检查 100%、125%、150% 缩放，不能仅靠浏览器预览判断。
- 低动效模式减少脉冲、飞线和 DPR，保持真实挤出地形、标签及机房选择。WebGL 初始化失败给出可理解的提示与重试，不把静态占位图标为完成 3D 验收。
- 同一时刻只保留必要的渲染循环。关窗、切离首页、地图不可见时停止；恢复时不补跑积压动画。后台预览销毁时也必须释放 geometry、material、texture、监听器与 RAF。
- 管理端变更点位、标签、显示编号与资源后，地图读取新发布数据。品牌配置的局部应用只更新必要属性；无须每个数值变化就重建全部地形。
- 省级底图属于随包只读资产。管理端可编辑业务点位和示意线，不提供在线地理搜索、瓦片服务或任意替换行政边界的入口。
- 内蒙古保持区域示意点位，未获得具体机房城市前不把坐标标成实测位置；X1 分布仍是演示样例。
- 标准验收：1920×1080、1440×900、1366×768 下地图可交互、文字清晰、标签不漂移；目标演示机记录帧率，不能承诺任何设备均达到同一性能。
