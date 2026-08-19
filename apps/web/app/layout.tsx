import type { ReactNode } from 'react';

export const metadata = {
  title: 'PR Search',
  description: 'GitHub Enterprise PR·커밋 검색과 머지 시퀀스 조사 대시보드',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
