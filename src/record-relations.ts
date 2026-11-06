import {collections,type Collection,type Row,type State} from './store';

export const relations:Record<string,Collection>={edgeTenantId:'tenants',siteId:'sites',preferredSiteId:'sites',routeTo:'sites',preferredNodeId:'nodes',nodeId:'nodes',tenantId:'tenants',productId:'products',orderId:'orders',instanceId:'instances',taskId:'tasks',usageRecordId:'usage'};

export function recordReferences(kind:Collection,row:Row):{kind:Collection;id:string}[]{
 const refs=Object.entries(relations).flatMap(([field,target])=>typeof row[field]==='string'&&row[field]?[{kind:target,id:row[field]}]:[]);
 if(kind==='logs'&&collections.includes(row.entityType)&&row.entityId)refs.push({kind:row.entityType,id:row.entityId});
 return refs;
}

export function incomingReferences(state:State,kind:Collection,id:string){
 return collections.flatMap(source=>state[source]
  .filter(row=>!(source===kind&&row.id===id)&&recordReferences(source,row).some(ref=>ref.kind===kind&&ref.id===id))
  .map(row=>({kind:source,id:row.id})));
}
