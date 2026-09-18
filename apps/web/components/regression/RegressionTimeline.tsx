'use client';
import type { KeyboardEvent, ReactNode } from 'react';
import { observedVerdict, revisionLabel, type Integration, type Investigation, type Run, type Snapshot } from '../../lib/regression/model';

function moveFocus(event: KeyboardEvent<SVGGElement>): void {
  if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  event.preventDefault();
  const nodes=Array.from(event.currentTarget.ownerSVGElement?.querySelectorAll<SVGGElement>('[data-map-point]')??[]);
  const index=nodes.indexOf(event.currentTarget);
  nodes[event.key==='Home'?0:event.key==='End'?nodes.length-1:Math.max(0,Math.min(nodes.length-1,index+(event.key==='ArrowRight'?1:-1)))]?.focus();
}
export function RegressionTimeline({data,run,pass,session,points,next,zoom,onPoint,onRun}: {
  data:Snapshot;run:Run;pass:Run;session:Investigation|null;points:readonly Integration[];next:Integration|null;
  zoom:number;onPoint:(p:Integration)=>void;onRun:(r:Run)=>void;
}): ReactNode {
  const width=960*zoom,left=100,right=45,inner=width-left-right;
  const x=(seq:number):number=>left+Math.max(0,points.findIndex(p=>p.seq===seq))/Math.max(1,points.length-1)*inner;
  const visible=new Set(points.map(p=>p.seq));const good=session?.good??pass.seq??0,bad=session?.bad??run.seq??0;
  const marks=data.runs.filter(r=>r.seq!==null&&visible.has(r.seq));
  const lanes={Regression:165,Field:225,MTBF:285};
  return <div className="rg-map-scroll" tabIndex={0} aria-label="Scrollable integration timeline">
    <svg className="rg-map" style={{width}} viewBox={`0 0 ${width} 340`} role="group" aria-label="First-parent integrations and MDVP evidence. Arrow keys move between points.">
      <rect x={x(good)} y={46} width={Math.max(1,x(bad)-x(good))} height={264} className="rg-range-band" rx={5}/>
      {points.filter((_,i)=>i%Math.max(1,Math.ceil(points.length/7))===0||i===points.length-1).map(p=><g key={p.seq}>
        <line x1={x(p.seq)} y1={46} x2={x(p.seq)} y2={310} className="rg-grid-line"/>
        <text x={x(p.seq)} y={24} textAnchor="middle" className="rg-map-label">{p.m===null?`S-${p.seq}`:`M-${p.m}`}</text>
        <text x={x(p.seq)} y={328} textAnchor="middle" className="rg-map-small">{p.integratedAt.slice(5,16).replace('T',' ')} KST</text>
      </g>)}
      <text x={16} y={85} className="rg-lane-label">{data.scope.branch.toUpperCase()}</text><text x={16} y={101} className="rg-map-small">first-parent</text>
      {[90,...Object.values(lanes)].map(y=><line key={y} x1={left} y1={y} x2={width-right} y2={y} className="rg-base-line"/>)}
      {Object.entries(lanes).map(([label,y])=><text key={label} x={16} y={y+4} className="rg-lane-label">{label.toUpperCase()}</text>)}
      {points.map(p=>{const verdict=observedVerdict(p,run,pass,session);return <g key={p.seq} className={`rg-map-node rg-verdict-${verdict.toLowerCase()}`} role="button" tabIndex={0} data-map-point
        aria-label={`${revisionLabel(p)}, ${p.pr===null?'direct push':`PR ${p.pr}`}, ${verdict}, ${p.artifact?'binary available':'binary unavailable'}`}
        onClick={()=>onPoint(p)} onKeyDown={e=>{moveFocus(e);if(e.key==='Enter'||e.key===' '){e.preventDefault();onPoint(p);}}}>
        <title>{revisionLabel(p)} · S-{p.seq} · {p.title}</title><rect x={x(p.seq)-7} y={73} width={14} height={34} className="rg-node-hit" rx={3}/>
        <rect x={x(p.seq)-3.5} y={86.5} width={7} height={7} rx={p.pr===null?0:1.5} fill={p.artifact?'currentColor':'var(--ui-surface-raised)'} stroke="currentColor"
          strokeDasharray={p.artifact?undefined:'2 1'} transform={p.pr===null?`rotate(45 ${x(p.seq)} 90)`:undefined}/>
      </g>;})}
      {marks.map(r=><g key={r.id} className={`rg-map-node rg-verdict-${r.status.toLowerCase()}`} role="button" tabIndex={0} data-map-point
        aria-label={`${r.id} ${r.title} ${r.status}, completed ${r.completedAt}`} onClick={()=>onRun(r)}
        onKeyDown={e=>{moveFocus(e);if(e.key==='Enter'||e.key===' '){e.preventDefault();onRun(r);}}}>
        <title>{r.id} · {r.status} · completed {r.completedAt}</title>
        <rect x={x(r.seq??0)-13} y={lanes[r.type]-16} width={26} height={32} className="rg-node-hit" rx={5}/>
        <circle cx={x(r.seq??0)} cy={lanes[r.type]} r={r.id===run.id?11:9} fill="var(--ui-surface-raised)" stroke="currentColor" strokeWidth={r.id===run.id?2.5:1.5} strokeDasharray={r.status==='INCONCLUSIVE'?'3 2':undefined}/>
        <text x={x(r.seq??0)} y={lanes[r.type]+4} textAnchor="middle" className="rg-map-symbol">{r.status==='PASS'?'✓':r.status==='FAIL'?'×':'Ⅱ'}</text>
        <text x={x(r.seq??0)} y={lanes[r.type]+27} textAnchor="middle" className="rg-map-small">#{r.id.replace('MDVP-','')}</text>
      </g>)}
      {next&&visible.has(next.seq)?<g pointerEvents="none" aria-hidden="true"><line x1={x(next.seq)} x2={x(next.seq)} y1={44} y2={310} className="rg-next-line"/><rect x={x(next.seq)-54} y={43} width={108} height={22} rx={4} className="rg-next-label"/><text x={x(next.seq)} y={58} textAnchor="middle" className="rg-map-next">S-{next.seq} · {session?'NEXT':'PREVIEW'}</text></g>:null}
    </svg>
  </div>;
}
