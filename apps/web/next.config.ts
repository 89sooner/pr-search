import type { NextConfig } from 'next';

const config: NextConfig = {
  // 워크스페이스 패키지는 빌드된 ESM을 그대로 소비한다.
  transpilePackages: ['@prs/contracts'],
};

export default config;
