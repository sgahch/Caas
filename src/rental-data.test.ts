import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seed,clone,DAY,tick,terminateOrder,validate} from './store';
import {rentalAccrual,orderAccrual,rentalStats,rentalWindow,rentalBuckets,bollinger} from './rental-data';
import {productCatalog,enrichProductCatalog,PRODUCT_CATALOG_EVENT} from './product-catalog';
import {sampleNodes,createRentalSample} from './scenario';
import {commerceChartOptions} from './commerce-view';
import {defaultConfig} from './config';

const at=(s:string)=>Date.parse(s+'+08:00');
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<.00001,`${a} != ${b}`);
test('calendar periods use Beijing time, Monday weeks, real months and years',()=>{
 const now=at('2026-10-23T12:00:00');
 assert.equal(rentalWindow(now,'day').start,at('2026-10-23T00:00:00'));
 assert.equal(rentalWindow(now,'week').start,at('2026-10-19T00:00:00'));
 assert.equal(rentalWindow(now,'month').end,at('2026-11-01T00:00:00'));
 assert.equal(rentalWindow(now,'year').end,at('2027-01-01T00:00:00'));
 const leap=rentalWindow(at('2024-02-29T23:59:59'),'month');assert.equal(leap.end-leap.start,29*DAY);
 assert.equal(rentalWindow(at('2027-01-01T00:00:00'),'week').start,at('2026-12-28T00:00:00'));
});
test('rental accrual is continuous and hourly partitions conserve a 30-day contract',()=>{
 const s=seed(),o=s.orders[0],from=o.activatedAt,monthly=o.unitPriceCents*o.quantity;
 close(orderAccrual(o,from,from+30*DAY,from+30*DAY),monthly);
 close(orderAccrual(o,from,from+3600000,from+DAY),monthly/720);
 close(orderAccrual(o,from,from+1000,from+DAY),monthly/(30*86400));
 const parts=Array.from({length:24},(_,i)=>orderAccrual(o,from+i*3600000,from+(i+1)*3600000,from+DAY)).reduce((a,b)=>a+b,0);
 close(parts,orderAccrual(o,from,from+DAY,from+DAY));
});
test('activation, termination, future dates and historical contract prices bound accrual',()=>{
 const s=seed(),o=clone(s.orders[0]),start=o.start;
 o.activatedAt=start+2*DAY;o.actualEndedAt=start+5*DAY;
 close(orderAccrual(o,start,start+30*DAY,start+30*DAY),o.unitPriceCents*o.quantity/10);
 o.actualEndedAt=0;o.activatedAt=start;o.end=start+60*DAY;o.contractPeriods=[{start,end:start+30*DAY,unitPriceCents:30000,quantity:1},{start:start+30*DAY,end:o.end,unitPriceCents:60000,quantity:1}];
 assert.equal(orderAccrual(o,start,o.end,o.end),90000);
 assert.equal(orderAccrual(o,start,o.end,start+DAY),1000);
 o.activatedAt=0;assert.equal(orderAccrual(o,start,o.end,o.end),0);
});
test('period buckets reconcile with cards and future buckets are empty',()=>{
 const s=seed();for(const p of ['day','week','month','year'] as const){const rows=rentalBuckets(s,p),total=rows.reduce((sum,r)=>sum+(r.amount||0),0);close(total,rentalStats(s).periods[p]);const last=rows.filter(r=>r.cumulative!==null).at(-1)!;close(last.cumulative!,total);assert.ok(rows.filter(r=>r.time>s.demoNow).every(r=>r.amount===null));}
 assert.equal(rentalBuckets(s,'day').length,24);assert.equal(rentalBuckets(s,'week').length,7);assert.equal(rentalBuckets(s,'month').length,31);assert.equal(rentalBuckets(s,'year').length,12);
});
test('rent grows with business time, ends with the contract and ignores token capacity',()=>{
 const s=seed(),before=rentalStats(s),oldPaid=before.paid;tick(s,10);const after=rentalStats(s);
 close(after.periods.day-before.periods.day,before.monthly*10000/(30*DAY));assert.equal(after.paid,oldPaid);
 const o=s.orders[0];terminateOrder(s,o.id);const frozen=orderAccrual(o,0,s.demoNow,s.demoNow);tick(s,10);assert.equal(orderAccrual(o,0,s.demoNow,s.demoNow),frozen);assert.ok(rentalStats(s).monthly<before.monthly);
 const edge=s.nodes.filter(n=>n.deviceType==='edge');edge.forEach(n=>n.cpu*=2);assert.equal(rentalAccrual(s,0),rentalAccrual({...s,nodes:s.nodes.filter(n=>n.deviceType!=='edge')},0));
});
test('Bollinger has a 20-observation warmup and zero width for constant rent',()=>{
 const bands=bollinger(Array(22).fill(12));assert.equal(bands[18].mean,null);assert.deepEqual(bands[19],{mean:12,upper:12,lower:12});const varied=bollinger([...Array(20).fill(12),30]).at(-1)!;assert.ok(varied.upper!>varied.mean!);assert.ok(varied.lower!>=0);
});
test('four named products preserve hardware inventory and require a real quote before rental',()=>{
 const s=seed(),hardware=clone(s.nodes);assert.equal(productCatalog.length,4);for(const p of productCatalog)assert.ok(s.products.some(r=>r.id===p.id));
 const x8=s.products.find(p=>p.id==='PROD-TITANPOWER-X8')!,input={business:'rental',productId:x8.id,gpu:8,cpu:128,memory:500,edgeUnits:0};assert.deepEqual(sampleNodes(s,input),[]);
 x8.unitPriceCents=1200000;const nodes=sampleNodes(s,input);assert.ok(nodes.length>0);assert.ok(nodes.every(n=>n.model==='RTX 5090'&&n.gpu===8));
 createRentalSample(s,{...input,nodeId:nodes[0].id,tenantId:'TEN-1'});assert.equal(s.orders.at(-1)!.gpu,8);validate(s);
 const star=s.products.find(p=>p.id==='PROD-STARHERO-X1')!;assert.deepEqual(sampleNodes(s,{...input,productId:star.id}),[]);assert.throws(()=>createRentalSample(s,{...input,productId:star.id,nodeId:'EDGE-01',tenantId:'TEN-1'}),/不能出租/);
 assert.deepEqual(s.nodes,hardware.map(n=>({...n,allocated:s.nodes.find(r=>r.id===n.id)!.allocated})));
});
test('catalog upgrade is idempotent and preserves operator prices and labels',()=>{
 const s=seed(),p=s.products.find(p=>p.id==='PROD-SLX-V4')!;p.unitPriceCents=76500;p.name='客户自定义';s.processedDemoEventIds=s.processedDemoEventIds.filter(x=>x!==PRODUCT_CATALOG_EVENT);assert.equal(enrichProductCatalog(s),true);assert.equal(enrichProductCatalog(s),false);assert.equal(p.unitPriceCents,76500);assert.equal(p.name,'客户自定义');
});
test('the live rental curve advances in value and matches the day card',()=>{
 const s=seed(),c=defaultConfig(),first=commerceChartOptions('rent-live',s,c).series[0].data.at(-1);tick(s,5);const last=commerceChartOptions('rent-live',s,c).series[0].data.at(-1);assert.ok(last>first);close(last,rentalStats(s).periods.day/100);
});
