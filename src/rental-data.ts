import {DAY,dayKey,type Row,type State} from './store';

export type RentalPeriod='day'|'week'|'month'|'year';
export const rentalPeriods:Record<RentalPeriod,string>={day:'日',week:'周',month:'月',year:'年'};
const HOUR=3600000;
export function rentalWindow(now:number,period:RentalPeriod){
 const d=new Date(now+8*HOUR),y=d.getUTCFullYear(),m=d.getUTCMonth();
 const day=Date.parse(dayKey(now)+'T00:00:00+08:00');
 if(period==='day')return {start:day,end:day+DAY};
 if(period==='week'){const start=day-((d.getUTCDay()+6)%7)*DAY;return {start,end:start+7*DAY};}
 const start=Date.UTC(y,period==='year'?0:m,1)-8*HOUR;
 return {start,end:Date.UTC(period==='year'?y+1:y,period==='year'?0:m+1,1)-8*HOUR};
}
export function rentalOrders(s:State){return s.orders.filter(o=>{
 const p=s.products.find(p=>p.id===o.productId),n=s.nodes.find(n=>n.id===o.nodeId);
 return o.activatedAt>0&&['裸金属','GPU','整机'].includes(o.resourceType)&&p?.rentable!==false&&n?.deviceType!=='edge';
});}
// Accrued income is continuous. Invoices retain the existing whole-day settlement rule.
// Return fractional cents until presentation so hourly/daily partitions conserve money.
export function orderAccrual(o:Row,from:number,to:number,now:number){
 const start=Math.max(from,o.start,o.activatedAt||Infinity),end=Math.min(to,now,o.end,o.actualEndedAt||Infinity);
 if(end<=start)return 0;
 return o.contractPeriods.reduce((sum:number,p:Row)=>sum+Math.max(0,Math.min(end,p.end)-Math.max(start,p.start))*p.unitPriceCents*p.quantity/(30*DAY),0);
}
export function rentalAccrual(s:State,from:number,to=s.demoNow,orders=rentalOrders(s)){return orders.reduce((sum,o)=>sum+orderAccrual(o,from,to,s.demoNow),0);}
export function rentalMonthly(s:State){return rentalOrders(s).reduce((sum,o)=>{
 if(o.actualEndedAt||o.end<=s.demoNow||o.activatedAt>s.demoNow)return sum;
 const p=o.contractPeriods.find((p:Row)=>p.start<=s.demoNow&&p.end>s.demoNow);
 return sum+(p?p.unitPriceCents*p.quantity:0);
},0);}
export function rentalStats(s:State){
 const orders=rentalOrders(s),year=rentalWindow(s.demoNow,'year'),monthly=rentalMonthly(s);
 const periods=Object.fromEntries((Object.keys(rentalPeriods) as RentalPeriod[]).map(p=>[p,rentalAccrual(s,rentalWindow(s.demoNow,p).start,s.demoNow,orders)])) as Record<RentalPeriod,number>;
 const active=orders.filter(o=>!o.actualEndedAt&&o.end>s.demoNow),held=s.instances.filter(v=>v.allocationHeld&&v.businessType==='rental');
 const due=s.bills.reduce((sum,b)=>sum+b.amountCents,0),paid=s.bills.reduce((sum,b)=>sum+b.paidCents,0);
 // Forecast only the remaining signed terms, without assuming renewals or future sales.
 const contractedYearEnd=orders.reduce((sum,o)=>sum+orderAccrual(o,year.start,year.end,year.end),0);
 return {periods,monthly,active:active.length,rentedGpu:held.reduce((sum,v)=>sum+v.gpu,0),due,paid,unpaid:due-paid,contractedYearEnd};
}
export function rentalBuckets(s:State,period:RentalPeriod){
 const {start,end}=rentalWindow(s.demoNow,period),orders=rentalOrders(s),rows:{time:number;end:number;label:string;amount:number|null;cumulative:number|null}[]=[];
 let cursor=start,total=0;
 while(cursor<end){
  const date=new Date(cursor+8*HOUR),next=period==='year'?Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1)-8*HOUR:cursor+(period==='day'?HOUR:DAY);
  const future=cursor>s.demoNow,amount=future?null:rentalAccrual(s,cursor,Math.min(next,s.demoNow),orders);total+=amount||0;
  rows.push({time:cursor,end:next,label:period==='day'?String(date.getUTCHours()).padStart(2,'0')+':00':period==='year'?date.getUTCMonth()+1+'月':dayKey(cursor).slice(5),amount,cumulative:future?null:total});cursor=next;
 }
 return rows;
}
export function hourlyRental(s:State){
 const end=Math.floor(s.demoNow/HOUR)*HOUR,orders=rentalOrders(s);
 return Array.from({length:48},(_,i)=>{const time=end-(47-i)*HOUR;return {time,amount:rentalAccrual(s,time,Math.min(time+HOUR,s.demoNow),orders),partial:time+HOUR>s.demoNow};});
}
export function bollinger(values:number[],window=20){return values.map((_,i)=>{
 if(i+1<window)return {mean:null,upper:null,lower:null};
 const a=values.slice(i+1-window,i+1),mean=a.reduce((sum,v)=>sum+v,0)/window,sd=Math.sqrt(a.reduce((sum,v)=>sum+(v-mean)**2,0)/window);
 return {mean,upper:mean+2*sd,lower:Math.max(0,mean-2*sd)};
});}
export function rentalBreakdown(s:State,period:RentalPeriod,by:'site'|'product'|'tenant'){
 const from=rentalWindow(s.demoNow,period).start,groups=new Map<string,{id:string;name:string;amount:number}>();
 for(const o of rentalOrders(s)){
  const id=by==='tenant'?o.tenantId:by==='product'?o.productId:s.nodes.find(n=>n.id===o.nodeId)?.siteId||o.preferredSiteId;
  const name=by==='tenant'?s.tenants.find(r=>r.id===id)?.name:by==='product'?s.products.find(r=>r.id===id)?.name:s.sites.find(r=>r.id===id)?.name;
  const row=groups.get(id)||{id,name:name||id,amount:0};row.amount+=orderAccrual(o,from,s.demoNow,s.demoNow);groups.set(id,row);
 }
 return [...groups.values()].sort((a,b)=>b.amount-a.amount);
}
