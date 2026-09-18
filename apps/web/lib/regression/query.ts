import type { Scope } from './model';
export type RegressionView = 'atlas' | 'inbox' | 'pulse';
export interface RegressionQuery { view: RegressionView; scope: Scope; run: string; date: string; type: string }
export function regressionQuery(params: Pick<URLSearchParams,'get'>, fallback: {scope:Scope;date:string;run:string}): RegressionQuery {
  const view=params.get('view');const rawEpoch=params.get('epoch');
  const epoch=rawEpoch===null?fallback.scope.epoch:Number(rawEpoch);
  return { view:view==='inbox'||view==='pulse'?view:'atlas',scope:{repository:params.get('repo')??fallback.scope.repository,
    branch:params.get('branch')??fallback.scope.branch,epoch:Number.isSafeInteger(epoch)&&epoch>0?epoch:0},
    date:params.get('date')??fallback.date,run:params.get('run')??fallback.run,type:params.get('type')??'all' };
}
export function regressionUrl(query: RegressionQuery): string {
  return '/regression?'+new URLSearchParams({view:query.view,repo:query.scope.repository,branch:query.scope.branch,
    epoch:String(query.scope.epoch),run:query.run,date:query.date,type:query.type}).toString();
}
