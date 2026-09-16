'use client';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { WorkspaceDetail } from './RepositoryWorkspace';

/** CR-094: shared deep links retain a reader UI without mounting legacy components. */
export function WorkspaceEntityPage({ repository, prNumber, commitSha, gheBaseUrl }: { repository: string; prNumber?: number; commitSha?: string; gheBaseUrl?: string }): ReactNode {
  const router = useRouter();
  return <section className="repo-main"><a href={`/search?${new URLSearchParams({ repository })}`}>← Search</a><header className="repo-heading"><h1>{repository} · {prNumber ? `#${prNumber}` : commitSha?.slice(0, 12)}</h1></header>
    <WorkspaceDetail row={{ kind: prNumber ? 'pull_request' : 'commit', repository, ...(prNumber ? { pr_number: prNumber } : {}), ...(commitSha ? { commit_sha: commitSha } : {}), title: null, author: null, state: null, merge_seq: null, seq_epoch: null, sequence_space: null, merged_at: null, changed_files_count: null, additions: null, deletions: null, url: null }} {...(gheBaseUrl ? { gheBaseUrl } : {})} onPath={path => { router.push(`/search?${new URLSearchParams({ repository, path, tab: 'history' })}`); }} />
  </section>;
}
