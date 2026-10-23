import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seed,clone,advance,metrics,dayKey,validate} from './store';
import {defaultTokenSimulation,modelShares,tokenStats,tokenMinutes,validateTokenSimulation} from './token-engine';
import {LiveResourceHistory} from './dashboard-data';

test('one engine conserves cumulative output and per-second/minute totals, batching is deterministic',()=>{
 const a=seed(),b=clone(a),settings=defaultTokenSimulation(),before=metrics(a);
 advance(a,a.demoNow+120000,settings);
 for(let i=0;i<120;i++)advance(b,b.demoNow+1000,settings);
 const points=a.tokenHistory!.filter(p=>!p.seeded),sum=points.reduce((n,p)=>n+p.tokens,0);
 assert.equal(metrics(a).totalToken-before.totalToken,sum);assert.equal(metrics(a).token-before.token,sum);
 assert.deepEqual(a.tokenMeters,b.tokenMeters);assert.deepEqual(a.tokenHistory,b.tokenHistory);
 assert.ok(new Set(points.map(p=>p.tokens)).size>30);
 const stats=tokenStats(a,settings);assert.equal(stats.minute,points.slice(-60).reduce((sum,p)=>sum+p.tokens,0));assert.equal(stats.average,stats.minute/60);
 assert.equal(tokenMinutes(a,settings).reduce((sum,p)=>sum+p.tokens,0),a.tokenHistory!.reduce((sum,p)=>sum+p.tokens,0));validate(a);
});
test('UTC+8 midnight splits daily output while lifetime output and rate history stay continuous',()=>{
 const s=seed(),at=Date.parse(dayKey(s.demoNow)+'T23:59:59+08:00');s.demoNow=s.lastMeteredAt=at;
 const oldDay=dayKey(at),before=metrics(s),settings=defaultTokenSimulation();advance(s,at+2000,settings);
 const actual=s.tokenHistory!.filter(p=>!p.seeded);assert.equal(actual.length,2);
 assert.equal(metrics(s).totalToken-before.totalToken,actual[0].tokens+actual[1].tokens);
 assert.equal(metrics(s).token,actual[1].tokens);
 assert.equal(s.tokenMeters.reduce((sum,m)=>sum+(m.dailyCounters.find((d:any)=>d.date===oldDay)?.outputTokens||0),0)-before.token,actual[0].tokens);validate(s);
});
test('offline or paused instances do not generate, zero multiplier stops, and history is bounded',()=>{
 const s=seed(),settings={variable:false,variation:0,multiplier:0};const before=metrics(s).totalToken;
 advance(s,s.demoNow+1000,settings);assert.equal(metrics(s).totalToken,before);assert.equal(s.tokenHistory!.at(-1)!.tokens,0);
 for(const v of s.instances)v.status='已暂停';advance(s,s.demoNow+1000,defaultTokenSimulation());assert.equal(metrics(s).totalToken,before);
 assert.equal(tokenStats(s,settings,false).current,0);
 const bounded=seed();advance(bounded,bounded.demoNow+3700000,settings);assert.equal(bounded.tokenHistory!.length,3600);
 assert.throws(()=>validateTokenSimulation({variable:true,variation:1,multiplier:1}));
});
test('model share rounding is exact, demo history is full on entry and retains current weighted values',()=>{
 const shares=modelShares([{name:'A',value:1},{name:'B',value:1},{name:'C',value:1}]);assert.equal(shares.reduce((sum,m)=>sum+Math.round(m.percent*10),0),1000);
 assert.deepEqual(modelShares([]),[]);assert.equal(modelShares([{name:'A',value:0}])[0].percent,0);
 const s=seed(),h=new LiveResourceHistory(),before=clone(s),first=h.observe(s,'demo',true);assert.equal(first.times.length,121);assert.deepEqual(s,before);
 advance(s,s.demoNow+1000);const next=h.observe(s,'demo',true);assert.equal(next.times.length,121);assert.equal(next.times.at(-1)!-next.times[0],120000);
});
