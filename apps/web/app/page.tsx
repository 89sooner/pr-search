/** 루트 진입 (WP-015·WP-073): 로그인 상태를 확인하고 기존 조사 화면으로 안내한다. */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { WorkbenchIcon } from '../components/WorkbenchIcon';
import { EmptyState } from '../components/EmptyState';
import { GuardedPage } from '../lib/server/page-guard';

export const dynamic = 'force-dynamic';

export default function HomePage(): ReactNode {
  // 세션 관문은 `GuardedPage` 하나가 소유한다 (WP-018).
  return (
    <GuardedPage
      title="PR Search"
      returnTo="/"
      whenAuthDisabled={<EmptyState cause="no_permission" title="인증이 구성되지 않았습니다"
        description="GitHub Enterprise 데이터에 접근하려면 사내 로그인이 필요합니다. 운영자에게 인증 설정을 확인하세요."
        actions={<Link href="/search">검색 작업대 열기</Link>} />}
    >
      <header className="prs-page-heading"><div><p className="prs-eyebrow">GITHUB ENTERPRISE</p><h1>변경 이력 작업대</h1></div></header>
      <div className="prs-home-workflows">
        <Link href="/search#omni-search-input"><WorkbenchIcon name="search" /><strong>PR · 커밋 검색</strong><span>식별자 하나로 변경과 연결된 PR을 찾습니다.</span><WorkbenchIcon name="arrow" /></Link>
        <Link href="/ranges"><WorkbenchIcon name="range" /><strong>머지 범위 조사</strong><span>검증한 지점부터 문제가 발생한 지점까지 좁힙니다.</span><WorkbenchIcon name="arrow" /></Link>
        <Link href="/repositories"><WorkbenchIcon name="repository" /><strong>저장소 탐색</strong><span>수집 상태와 브랜치별 시퀀스 공간을 확인합니다.</span><WorkbenchIcon name="arrow" /></Link>
        <Link href="/saved-searches"><WorkbenchIcon name="bookmark" /><strong>저장된 검색</strong><span>자주 사용하는 조사 조건을 다시 실행합니다.</span><WorkbenchIcon name="arrow" /></Link>
      </div>
    </GuardedPage>
  );
}
