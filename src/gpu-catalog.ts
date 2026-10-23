import type {State} from './store';

export const GPU_CATALOG_EVENT='catalog:gpu-models-v1';
export const demoGpuModels:Record<string,{before:string;model:string}>={
 'NN-13':{before:'A100',model:'H200'},'NN-14':{before:'A100',model:'H200'},
 'NN-15':{before:'A100',model:'B300'},'NN-16':{before:'A100',model:'RTX 5090'},
 'CD-11':{before:'A100',model:'A800'},'CD-12':{before:'A100',model:'L40S'},
 'IM-09':{before:'H800',model:'H200'},'IM-10':{before:'H800',model:'B300'},
 'IM-11':{before:'H800',model:'RTX 5090'},'IM-12':{before:'H800',model:'L40S'}
};
// Upgrade unused standard demo nodes once. Capacity, custom models and business references survive.
export function enrichDemoGpuModels(s:State){
 if(s.processedDemoEventIds.includes(GPU_CATALOG_EVENT))return false;
 for(const [id,spec] of Object.entries(demoGpuModels)){
  const node=s.nodes.find(n=>n.id===id);
  if(!node||node.deviceType!=='center'||node.gpu!==8||node.model!==spec.before)continue;
  const referenced=[...s.orders,...s.tasks,...s.instances,...s.usage].some(r=>r.nodeId===id||r.preferredNodeId===id);
  if(!referenced)node.model=spec.model;
 }
 s.processedDemoEventIds.push(GPU_CATALOG_EVENT);return true;
}
