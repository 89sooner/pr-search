/**
 * 실행 환경 변수의 허용 목록 (FR-GH-002 AC-6·AC-7, FR-GH-008 AC-6·AC-7, ADR-016, 인프라 12장).
 *
 * 부모 프로세스의 환경을 **상속하지 않는다.** 여기 적은 키만 만들어 넘기며, 그
 * 값은 서버 설정과 실행별 임시 경로와 실행 직전에 실체화한 위임 토큰뿐이다.
 * `GH_TOKEN`·`GITHUB_TOKEN`·alias·extension·git 설정은 이 목록에 없으므로 자식이
 * 볼 수 없다.
 *
 * 공식 `gh help environment`가 정한 변수만 쓴다 (2026-09-13 확인):
 *
 * | 변수 | 값 | 이유 |
 * | --- | --- | --- |
 * | `GH_ENTERPRISE_TOKEN` | 위임 토큰 | GHES 호스트를 향한 명령의 인증 |
 * | `GH_HOST` | 서버 설정의 호스트 | 호스트가 없는 명령의 기본값 고정 |
 * | `GH_CONFIG_DIR`·`HOME`·`TMPDIR` | 실행별 임시 경로 | 자격 영속 저장·실행 간 공유 차단 |
 * | `GH_PROMPT_DISABLED` | `1` | 대화형 대기로 인한 행 방지 |
 * | `GH_NO_UPDATE_NOTIFIER`·`GH_NO_EXTENSION_UPDATE_NOTIFIER` | `1` | 갱신 확인 요청 금지 |
 * | `NO_COLOR`·`CLICOLOR`·`TERM` | `1`·`0`·`dumb` | ANSI 출력 억제 (무해화 경계의 부담을 줄인다) |
 * | `GH_PAGER` | 빈 문자열 | 페이저 프로세스 금지 |
 * | `SSL_CERT_FILE` | 사내 CA 경로 | Go 런타임은 `NODE_EXTRA_CA_CERTS`를 읽지 않는다 |
 * | `PATH` | 고정 시스템 경로 | gh가 `git`을 찾을 수 있게. 실행별로 바꾸지 않는다 |
 */

export const GH_EXECUTION_ENV_KEYS = [
  'PATH',
  'HOME',
  'TMPDIR',
  'GH_CONFIG_DIR',
  'GH_HOST',
  'GH_ENTERPRISE_TOKEN',
  'GH_PROMPT_DISABLED',
  'GH_NO_UPDATE_NOTIFIER',
  'GH_NO_EXTENSION_UPDATE_NOTIFIER',
  'NO_COLOR',
  'CLICOLOR',
  'TERM',
  'GH_PAGER',
  'SSL_CERT_FILE',
] as const;

export type GhExecutionEnvKey = (typeof GH_EXECUTION_ENV_KEYS)[number];

/** 값이 비밀인 키. 미리보기·이력에는 이름만 남고 값은 `<redacted>`다. */
export const GH_SECRET_ENV_KEYS: readonly GhExecutionEnvKey[] = ['GH_ENTERPRISE_TOKEN'];

/** 실행기가 gh에 주는 `PATH`. 컨테이너의 고정 경로이며 사용자 입력과 무관하다. */
export const GH_EXECUTION_PATH = '/usr/local/bin:/usr/bin:/bin';

export interface ExecutionEnvInput {
  readonly host: string;
  readonly token: string;
  readonly workspace: {
    readonly home: string;
    readonly configDir: string;
    readonly tmp: string;
  };
  /** 사내 CA 파일. 없으면 Go 기본 신뢰 저장소다. */
  readonly caFile?: string | null;
  readonly path?: string;
}

/** 실행 환경을 만든다. 반환 객체의 키 집합은 `GH_EXECUTION_ENV_KEYS`의 부분집합이다. */
export function buildExecutionEnv(input: ExecutionEnvInput): Record<GhExecutionEnvKey, string> {
  const env: Record<GhExecutionEnvKey, string> = {
    PATH: input.path ?? GH_EXECUTION_PATH,
    HOME: input.workspace.home,
    TMPDIR: input.workspace.tmp,
    GH_CONFIG_DIR: input.workspace.configDir,
    GH_HOST: input.host,
    GH_ENTERPRISE_TOKEN: input.token,
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    GH_NO_EXTENSION_UPDATE_NOTIFIER: '1',
    NO_COLOR: '1',
    CLICOLOR: '0',
    TERM: 'dumb',
    GH_PAGER: '',
    SSL_CERT_FILE: input.caFile ?? '',
  };
  if (input.caFile === undefined || input.caFile === null || input.caFile === '') {
    // 빈 값을 주면 Go가 무시하지만, 키 자체를 빼는 편이 「무엇을 줬는가」를 정직하게 만든다.
    delete (env as Partial<Record<GhExecutionEnvKey, string>>).SSL_CERT_FILE;
  }
  return env;
}

/** 미리보기·이력에 싣는 환경 키 목록. 비밀은 이름만 남는다 (C-062). */
export function describeExecutionEnv(env: Readonly<Partial<Record<GhExecutionEnvKey, string>>>): {
  readonly key: GhExecutionEnvKey;
  readonly value: string;
}[] {
  return (Object.keys(env) as GhExecutionEnvKey[]).map((key) => ({
    key,
    value: GH_SECRET_ENV_KEYS.includes(key) ? '<redacted>' : (env[key] ?? ''),
  }));
}
