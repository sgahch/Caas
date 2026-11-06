import type {State} from './store';
import {bundleIds,removeScenarioBundle} from './scenario';

export const CORE_CENTERS_EVENT='catalog:core-centers-v1';
export const CORE_CENTER_IDS=['NN','CD','IM'];

// Apply the requested inventory reduction once; later administrator edits survive restart.
export function retainCoreCenters(s:State,validateScene=true){
 if(s.processedDemoEventIds.includes(CORE_CENTERS_EVENT))return false;
 const removed=s.sites.filter(site=>site.kind==='center'&&!CORE_CENTER_IDS.includes(site.id));
 const sets:Record<string,Set<string>>={};
 for(const site of removed)for(const [kind,ids] of Object.entries(bundleIds(s,'sites',site.id))){
  sets[kind]||=new Set();
  for(const id of ids)sets[kind].add(id);
 }
 if(removed.length)removeScenarioBundle(s,sets,validateScene);
 s.processedDemoEventIds.push(CORE_CENTERS_EVENT);
 return true;
}
