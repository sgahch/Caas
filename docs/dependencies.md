# 锁定依赖与运行时

- echarts: 6.1.0
- lucide: 0.468.0
- three: 0.180.0
- @playwright/test: 1.61.1
- @types/node: 24.10.1
- @types/three: 0.180.0
- electron: 44.9.0
- electron-builder: 26.15.3
- esbuild: 0.28.2
- tsx: 4.23.15
- typescript: 5.9.3
- vite: 7.3.7

Windows运行时实测 Electron44.9.0 / Node24.22.0 / Chromium152.0.7977.167 / SQLite3.53.4。SQLite使用随Electron内嵌的node:sqlite，无额外.node驱动。

2026-10-19 npm audit：0高危、0严重、7项中等，全部在electron-builder开发依赖链（sprintf-js及上游）。这些开发工具未进入app.asar。没有执行force降级。
