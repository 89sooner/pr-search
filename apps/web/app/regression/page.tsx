import { Suspense, type ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { GuardedPage } from '../../lib/server/page-guard';
import { regressionEnabled } from '../../lib/regression/flags';
import { RegressionWorkbench } from '../../components/regression/RegressionWorkbench';

export const dynamic = 'force-dynamic';
/** FR-REG-001 / WP-095. Existing authentication boundary; no guessed MDVP endpoint. */
export default async function RegressionPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}):Promise<ReactNode> {
  if (!regressionEnabled) notFound();
  const params=await searchParams;const query=new URLSearchParams();
  for(const name of ['view','repo','branch','epoch','run','date','type']){const value=params[name];if(typeof value==='string')query.set(name,value);}
  return <GuardedPage reader title="Regression" returnTo={`/regression${query.size?'?'+query.toString():''}`}>
    <Suspense fallback={<p>Loading regression evidence…</p>}><RegressionWorkbench fixtureEnabled={process.env['REGRESSION_FIXTURE_ENABLED']==='1'}/></Suspense>
  </GuardedPage>;
}
