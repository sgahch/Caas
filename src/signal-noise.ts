// Time-addressed noise keeps histories stable across refreshes, restarts and batch ticks.
function random(seed:string,bucket:number){
 let n=2166136261;for(const c of seed+':'+bucket)n=Math.imul(n^c.charCodeAt(0),16777619);
 n^=n>>>16;n=Math.imul(n,0x45d9f3b);n^=n>>>16;return (n>>>0)/4294967295*2-1;
}
function drift(seed:string,time:number,scale:number){
 const bucket=Math.floor(time/scale),mix=time/scale-bucket;
 return random(seed,bucket)*(1-mix)+random(seed,bucket+1)*mix;
}
export function irregularSignal(seed:string,seconds:number){
 const fast=random(seed+':grain',Math.floor(seconds));
 const burst=random(seed+':burst',Math.floor(seconds/3));
 return Math.max(-1,Math.min(1,.42*fast+.28*drift(seed+':short',seconds,4)+.2*drift(seed+':long',seconds,19)+(Math.abs(burst)>.82?.28*burst:0)));
}
