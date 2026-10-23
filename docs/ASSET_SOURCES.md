# 素材与实现来源

批准图：用户提供执行包 `reference/ui-approved.png`，仅作深蓝布局与3D地图方向的参考，没有用整张图替代控件或地形。

地图：执行包随带 geoBoundaries gbOpen CHN ADM1，来源提交9469f09，代表2019年边界。34个行政单元、48个多边形、263343字节；SHA-256为 `bc4afc7eacf4351ae5b3ae7a612327987ce1123cb5deb8574fb49107091c6623`。原GeoJSON未修改，运行时采用统一Mercator投影、环绕序归一与Three.js挤出。

数据署名：geoBoundaries，原始来源含 Wikimedia Commons；gbOpen遵循CC BY 4.0署名条件，原始边界元数据标为Public Domain。完整许可、来源URL和元数据保留在 `public/maps/ATTRIBUTION.md`、`source-metadata.json`、`asset-manifest.json`。

旧版DataV地图已从正式随包资源移除。机房与X1点位为演示样例，内蒙古为区域示意，不表示实测机房位置。

应用图标是 `scripts/build-icon.mjs` 程序生成的几何图形；不使用远程图标、字体或CDN。默认字体回退到Windows本地字体。Three.js、ECharts和Electron等依赖的许可随相应分发或源码锁文件列明。
