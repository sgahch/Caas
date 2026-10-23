const frames=new Map<HTMLElement,number>();
export const compactToken=(value:number)=>value>=1e9?(value/1e9).toFixed(6)+' B':(value/1e6).toFixed(3)+' M';
export function paintToken(host:HTMLElement,target:number){
 const start=Number(host.dataset.amount??target);host.dataset.amount=String(target);
 const old=frames.get(host);if(old)cancelAnimationFrame(old);
 const began=performance.now(),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const paint=(at:number)=>{if(!host.isConnected){frames.delete(host);return;}const t=reduced?1:Math.min(1,(at-began)/550),value=Math.round(start+(target-start)*(1-Math.pow(1-t,3)));const compact=host.querySelector('.metric-value'),exact=host.querySelector('.metric-exact');if(compact)compact.textContent=compactToken(value);if(exact)exact.textContent=value.toLocaleString('zh-CN')+' Tokens';if(t<1)frames.set(host,requestAnimationFrame(paint));else frames.delete(host);};
 paint(began);
}
export function clearNumberMotion(){frames.forEach(cancelAnimationFrame);frames.clear();}
