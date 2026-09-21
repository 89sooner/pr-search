import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const DIR = new URL('.', import.meta.url).pathname;
const read = n => JSON.parse(readFileSync(join(DIR, n), 'utf8'));
let fail = 0;
const bad = (f, m) => { console.log(`FAIL ${f}: ${m}`); fail++; };

const isStr = v => typeof v === 'string';
const isNum = v => typeof v === 'number';
const nullable = (v, t) => v === null || t(v);
const opt = (v, t) => v === undefined || t(v);

// @prs/contracts SourceEntry / SourceTree
const ENTRY_KINDS = ['directory', 'file', 'symlink', 'submodule'];
function checkTree(f, o) {
  if (!isStr(o.repository) || !isStr(o.ref) || !isStr(o.revision) || !isStr(o.path)) bad(f, 'tree scalar fields');
  if (typeof o.truncated !== 'boolean') bad(f, 'truncated');
  if (!Array.isArray(o.entries)) return bad(f, 'entries');
  for (const e of o.entries) {
    if (!isStr(e.path) || !isStr(e.name) || !isStr(e.sha)) bad(f, `entry scalars ${e.path}`);
    if (!ENTRY_KINDS.includes(e.kind)) bad(f, `entry kind '${e.kind}' not in union`);
    if (!nullable(e.size, isNum)) bad(f, `entry size ${e.path}`);
  }
}
function checkHistory(f, o) {
  if (!isStr(o.repository) || !isStr(o.revision) || !isStr(o.path)) bad(f, 'history scalars');
  if (!nullable(o.next_page, isNum)) bad(f, 'next_page');
  if (!opt(o.pull_requests_unavailable, v => typeof v === 'boolean')) bad(f, 'pull_requests_unavailable');
  for (const c of o.commits) {
    if (!isStr(c.sha) || !isStr(c.message) || !isStr(c.author)) bad(f, 'commit scalars');
    if (!Array.isArray(c.parents) || !c.parents.every(isStr)) bad(f, 'parents');
    if (!nullable(c.date, isStr)) bad(f, 'date');
    if (!(c.pull_request_numbers === null || (Array.isArray(c.pull_request_numbers) && c.pull_request_numbers.every(isNum))))
      bad(f, 'pull_request_numbers must be number[] or null');
  }
}
const FILE_STATUS = ['text', 'missing', 'binary', 'too_large', 'unsupported'];
function checkFile(f, o) {
  if (!isStr(o.repository) || !isStr(o.revision) || !isStr(o.path)) bad(f, 'file scalars');
  if (!FILE_STATUS.includes(o.status)) bad(f, `status '${o.status}' not in union`);
  if (!nullable(o.text, isStr)) bad(f, 'text');
  if (!nullable(o.size, isNum)) bad(f, 'size');
  if (!nullable(o.sha, isStr)) bad(f, 'sha');
  if (!nullable(o.reason, isStr)) bad(f, 'reason');
  if (o.status !== 'text' && o.text !== null) bad(f, 'non-text status must carry text:null');
}
function checkComparison(f, o) {
  if (!isStr(o.repository) || !isStr(o.head)) bad(f, 'comparison scalars');
  if (!nullable(o.base, isStr)) bad(f, 'base');
  if (!nullable(o.next_page, isNum)) bad(f, 'next_page');
  if (typeof o.truncated !== 'boolean') bad(f, 'truncated');
  const c = o.commit;
  if (!isStr(c.sha) || !isStr(c.message) || !isStr(c.author) || !Array.isArray(c.parents)) bad(f, 'commit');
  for (const x of o.files) {
    if (!isStr(x.path) || !isStr(x.status) || !isNum(x.additions) || !isNum(x.deletions)) bad(f, `change ${x.path}`);
    if (!nullable(x.previous_path, isStr)) bad(f, 'previous_path');
  }
  for (const p of o.pull_requests) {
    if (!isNum(p.number) || !isStr(p.title) || !nullable(p.body, isStr)) bad(f, 'pull_requests');
  }
}
// search-api SearchItem
const M_STATES = ['assigned', 'pending', 'not_applicable', 'unavailable'];
function checkSearch(f, o) {
  if (o.epoch_stale === true) {
    for (const k of ['items', 'total', 'facets', 'relaxation_hints'])
      if (k in o) bad(f, `epoch_stale response must omit '${k}'`);
    if (o.next_cursor !== null) bad(f, 'epoch_stale next_cursor must be null');
    return;
  }
  if (!isNum(o.total?.value) || !['eq', 'gte'].includes(o.total?.relation)) bad(f, 'total shape');
  if (!nullable(o.next_cursor, isStr)) bad(f, 'next_cursor');
  if (!isStr(o.sort?.field) || !['asc', 'desc'].includes(o.sort?.order)) bad(f, 'sort');
  for (const i of o.items) {
    if (!['pull_request', 'commit'].includes(i.kind)) bad(f, 'item kind');
    if (!nullable(i.repository, isStr)) bad(f, 'repository');
    for (const k of ['title', 'author', 'state', 'merge_seq', 'seq_epoch', 'sequence_space',
                     'merged_at', 'changed_files_count', 'additions', 'deletions', 'url'])
      if (!(k in i)) bad(f, `item missing required key '${k}'`);
    if (!nullable(i.merge_seq, isNum) || !nullable(i.seq_epoch, isNum)) bad(f, 'seq numbers');
    if (!Array.isArray(i.labels)) bad(f, 'labels must be array');
    if (i.kind === 'pull_request' && !isNum(i.pr_number)) bad(f, 'PR row needs pr_number');
    if (i.kind === 'commit' && !isStr(i.commit_sha)) bad(f, 'commit row needs commit_sha');
    if ('merge_number_state' in i && !M_STATES.includes(i.merge_number_state))
      bad(f, `merge_number_state '${i.merge_number_state}' not in union`);
    if (i.sequence_space !== null && !/^[^@]+@.+$/.test(i.sequence_space)) bad(f, 'sequence_space shape');
  }
}
function checkResolve(f, o) {
  if (!isStr(o.input) || !isStr(o.detected_kind)) bad(f, 'resolve scalars');
  if (typeof o.truncated !== 'boolean') bad(f, 'truncated');
  for (const c of o.candidates) {
    if (!['commit', 'pull_request'].includes(c.kind)) bad(f, 'candidate kind');
    for (const k of ['repository', 'display_name', 'url', 'merge_seq', 'seq_epoch', 'sequence_space'])
      if (!(k in c)) bad(f, `candidate missing '${k}'`);
    if (c.kind === 'commit' && !isStr(c.commit_sha)) bad(f, 'commit candidate needs commit_sha');
    if (c.kind === 'pull_request' && !isNum(c.pr_number)) bad(f, 'pr candidate needs pr_number');
  }
}
function checkRepos(f, o) {
  if (!Array.isArray(o.items)) return bad(f, 'items');
  if (!nullable(o.next_cursor, isStr)) bad(f, 'next_cursor');
  for (const r of o.items) {
    if (!isNum(r.repository_id) || !isStr(r.repository)) bad(f, 'repo scalars');
    if (!/^[^/]+\/[^/]+$/.test(r.repository)) bad(f, `repository '${r.repository}' must be owner/name`);
    if (!Array.isArray(r.sequence_spaces)) bad(f, 'sequence_spaces');
    for (const s of r.sequence_spaces) if (!isStr(s.base_branch)) bad(f, 'base_branch');
  }
}
function checkError(f, o) {
  if (!isStr(o.error?.code) || !isStr(o.error?.message)) bad(f, 'error shape');
  if (!isStr(o.correlation_id)) bad(f, 'correlation_id');
}

const files = readdirSync(DIR).filter(n => n.endsWith('.json')).sort();
for (const f of files) {
  const o = read(f);
  if (f.startsWith('source-tree')) checkTree(f, o);
  else if (f.startsWith('source-history')) checkHistory(f, o);
  else if (f.startsWith('source-file')) checkFile(f, o);
  else if (f.startsWith('source-diff')) checkComparison(f, o);
  else if (f.startsWith('search-')) checkSearch(f, o);
  else if (f.startsWith('resolve-')) checkResolve(f, o);
  else if (f.startsWith('repositories-')) checkRepos(f, o);
  else if (f.startsWith('error-')) checkError(f, o);
  else if (f.startsWith('detail-')) { /* 모든 키가 선택이라 구조 단언이 없다 */ }
  else bad(f, 'no validator matched this file name');
}
console.log(fail === 0 ? `PASS ${files.length} fixtures` : `${fail} failures across ${files.length} fixtures`);
process.exit(fail === 0 ? 0 : 1);
