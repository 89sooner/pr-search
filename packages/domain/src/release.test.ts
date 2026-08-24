/**
 * 릴리스 갱신 신호 판정 (WP-024 / CR-028, DEV-145).
 *
 * 이 시험이 지키는 것: **어떤 웹훅이 신호이고 어떤 것이 아닌가**의 경계.
 * 태그 push를 놓치면 실시간 갱신이 죽고(스윕까지 최대 6시간), 브랜치 push를
 * 신호로 읽으면 push마다 전량 diff가 돌아 낭비가 커진다.
 */

import { describe, expect, it } from 'vitest';
import { extractReleaseSignal } from './release.js';

const REPO = { repository: { id: 4021 } };

describe('extractReleaseSignal (JOB-REL-007 트리거)', () => {
  it('**태그 push가 신호다** — 채번이 skip하는 바로 그 이벤트다 (DEV-145)', () => {
    const outcome = extractReleaseSignal('push', { ...REPO, ref: 'refs/tags/v1.2.0' });
    expect(outcome).toEqual({ kind: 'signal', signal: { repositoryId: 4021 } });
  });

  it('**브랜치 push는 신호가 아니다** — push마다 태그 diff를 돌리지 않는다', () => {
    const outcome = extractReleaseSignal('push', { ...REPO, ref: 'refs/heads/main' });
    expect(outcome.kind).toBe('skip');
  });

  it('태그 삭제 push도 신호다 — diff가 지울 수 있어야 한다', () => {
    // 태그 삭제는 ref refs/tags/* + deleted:true의 push로 온다. ref만 보면 된다.
    const outcome = extractReleaseSignal('push', { ...REPO, ref: 'refs/tags/v1.0.0', deleted: true });
    expect(outcome.kind).toBe('signal');
  });

  it('`create(tag)`가 신호다', () => {
    expect(extractReleaseSignal('create', { ...REPO, ref_type: 'tag', ref: 'v2.0' }).kind).toBe('signal');
  });

  it('**`create(branch)`는 신호가 아니다** — ref_type이 가른다', () => {
    expect(extractReleaseSignal('create', { ...REPO, ref_type: 'branch', ref: 'feature/x' }).kind).toBe('skip');
  });

  it('`delete(tag)`가 신호다 (삭제 반영)', () => {
    expect(extractReleaseSignal('delete', { ...REPO, ref_type: 'tag', ref: 'v1.0' }).kind).toBe('signal');
  });

  it('`release` 이벤트는 항상 신호다 — published_at 덮어쓰기의 트리거다 (DEV-147)', () => {
    expect(extractReleaseSignal('release', { ...REPO, action: 'published' }).kind).toBe('signal');
  });

  it('PR 이벤트는 신호가 아니다', () => {
    expect(extractReleaseSignal('pull_request', { ...REPO }).kind).toBe('skip');
  });

  it('repository.id가 없으면 skip이다 — 어느 저장소를 다시 볼지 모른다', () => {
    expect(extractReleaseSignal('release', { action: 'published' }).kind).toBe('skip');
  });

  it('**신호는 태그 이름을 나르지 않는다** — 이벤트 순서 역전이 스냅숏을 되돌리지 못하게 (EVT-REL-001)', () => {
    const outcome = extractReleaseSignal('push', { ...REPO, ref: 'refs/tags/v9.9.9' });
    // signal에는 repositoryId만 있다. 태그가 실려 있으면 이 단언이 잡는다.
    expect(outcome).toEqual({ kind: 'signal', signal: { repositoryId: 4021 } });
  });
});
