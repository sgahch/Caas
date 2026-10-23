import type {Row,State} from './store';

export const PRODUCT_CATALOG_EVENT='catalog:rental-products-v1';
export const productCatalog:Row[]=[
 {id:'PROD-STARHERO-X1',name:'StarHero X1',subtitle:'边缘算力设备',resourceType:'边缘算力',unit:'台/月',unitPriceCents:0,rentable:false,gpuModel:'',gpuPerUnit:0,description:'仅本地生产 Token，不参与设备租赁'},
 {id:'PROD-SLX-V4',name:'SLX-V4 Pro',subtitle:'造元',resourceType:'裸金属',unit:'台/月',unitPriceCents:0,rentable:true,gpuModel:'RTX 4090',gpuPerUnit:1,description:'1 张 RTX 4090 · 裸金属专属节点'},
 {id:'PROD-TITANPOWER-X8',name:'TITANPOWER-X8',subtitle:'擎能',resourceType:'整机',unit:'台/月',unitPriceCents:0,rentable:true,gpuModel:'RTX 5090',gpuPerUnit:8,description:'8 张 RTX 5090 · 整机租赁'},
 {id:'PROD-MOQING-X9',name:'MOQING-X9',subtitle:'魔擎',resourceType:'整机',unit:'台/月',unitPriceCents:0,rentable:true,gpuModel:'RTX 5090',gpuPerUnit:8,description:'8 张 RTX 5090 · 整机租赁'}
];
// New product prices are intentionally unset until the operator supplies a quote.
// Keep all historical products and hardware counts; a catalog is not an inventory.
export function enrichProductCatalog(s:State){
 if(s.processedDemoEventIds.includes(PRODUCT_CATALOG_EVENT))return false;
 for(const p of productCatalog)if(!s.products.some(r=>r.id===p.id))s.products.push({...p});
 s.processedDemoEventIds.push(PRODUCT_CATALOG_EVENT);return true;
}
export function canRentProduct(p:Row|undefined){return !!p&&p.id!=='PROD-STARHERO-X1'&&p.rentable!==false&&['裸金属','GPU','整机'].includes(p.resourceType);}
export function matchesProduct(n:Row,p:Row){return n.deviceType==='center'&&(!p.gpuModel||n.model===p.gpuModel)&&(!p.gpuPerUnit||n.gpu===p.gpuPerUnit)&&(!n.productId||n.productId===p.id);}
