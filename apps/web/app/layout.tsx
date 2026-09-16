/**
 * 루트 레이아웃 (WP-015 / WP-084): 제품 토큰과 Radix 표면을 한 번 로드한다.
 * 테마는 html에 적용해 모든 포털이 같은 팔레트를 사용한다.
 */

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// 제품 토큰을 먼저 두고 화면별 배치를 그 위에 적용한다.
import './ui.css';
import './workbench.css';
import './repository-workspace.css';
import '@fontsource-variable/geist';
import './reader-workspace.css';
import './source-workspace.css';
import { ThemeProvider } from '../components/ui/ThemeProvider';
import { themeBootstrapScript } from '../components/ui/theme-script';

export const metadata: Metadata = {
  title: 'PR Search',
  description: 'Search and explore GitHub Enterprise pull requests and commits',
};

export default function RootLayout({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    /*
     * `lang`은 스크린 리더의 발음을 정한다 (NFR-007).
     *
     * 고정 bootstrap이 저장 선호도 또는 시스템 테마를 첫 페인트 전에 적용한다.
     */
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} /></head>
      <body><ThemeProvider>{children}</ThemeProvider></body>
    </html>
  );
}
