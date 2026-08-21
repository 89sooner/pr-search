/**
 * 루트 레이아웃 (WP-015).
 *
 * Conductor CSS를 **여기서 한 번만** 가져온다 (ADR-006). 컴포넌트마다
 * 가져오면 번들에 중복으로 들어가고, 로드 순서에 따라 토큰이 덮어써져
 * 라이트·다크 테마가 화면마다 달라진다.
 */

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// 순서가 뜻을 갖는다: 토큰이 먼저 서고 그 위에 컴포넌트 스타일이 온다.
import '@conductor-by-89soone/tokens/tokens.css';
import '@conductor-by-89soone/css';

export const metadata: Metadata = {
  title: 'PR Search',
  description: 'GitHub Enterprise PR·커밋 검색과 분석',
};

export default function RootLayout({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    /*
     * `lang`은 스크린 리더의 발음을 정한다 (NFR-007).
     *
     * 테마는 `data-theme`을 두지 않고 Conductor 기본(시스템 설정 추종)에
     * 맡긴다 — 사용자가 OS에서 정한 것을 앱이 덮어쓰지 않는다.
     */
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
