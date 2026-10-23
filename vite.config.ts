import { defineConfig } from 'vite';
export default defineConfig({base:'./',build:{chunkSizeWarningLimit:1200,rollupOptions:{output:{manualChunks(id){if(id.includes('node_modules')&&/echarts|zrender/.test(id))return 'charts';if(id.includes('node_modules/three')||id.includes('node_modules\\three'))return 'three';}}}}});
