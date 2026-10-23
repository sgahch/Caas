import {collections,type State} from './store';
// Drafts may contain unresolved business references, but never arbitrary types or unbounded trees.
export function validateStateShape(s:State){if(!s||s.version!==2||!Array.isArray(s.processedDemoEventIds)||s.processedDemoEventIds.some(x=>typeof x!=='string'))throw Error('草稿场景结构无效');let fields=0;
 const walk=(value:any,path:string,depth=0)=>{if(++fields>500000||depth>10)throw Error('内容结构过大或过深');if(typeof value==='string'){if(value.length>16000)throw Error(path+' 文本超过16000字');}else if(typeof value==='number'){if(!Number.isFinite(value))throw Error(path+' 数字无效');}else if(typeof value==='boolean'||value===null){}else if(Array.isArray(value)){if(value.length>20000)throw Error(path+' 列表过长');value.forEach((v,i)=>walk(v,path+'/'+i,depth+1));}else if(value&&typeof value==='object'){for(const [k,v] of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(k))throw Error('不支持的内容键');walk(v,path+'/'+k,depth+1);}}else throw Error(path+' 字段类型无效');};
 if(s.tokenHistory)walk(s.tokenHistory,'tokenHistory');
 for(const key of collections){if(!Array.isArray(s[key]))throw Error(key+' 需要列表');for(const row of s[key])if(!row||typeof row.id!=='string'||!row.id)throw Error(key+' 内部ID无效');walk(s[key],key);}return true;
}
