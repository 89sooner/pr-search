/**
 * 고정 `gh` 버전 (FR-GH-011 AC-1, ADR-015).
 *
 * **여기가 유일한 정본이다.** `Dockerfile`의 내려받기 단계, 실행기의 기동 검사,
 * 시험이 쓰는 바이너리 확보가 전부 이 값을 읽는다. `Dockerfile`은 셸이라 이
 * 모듈을 가져올 수 없으므로 같은 값을 리터럴로 적고, 회귀가 두 곳을 대조한다 —
 * 값이 두 곳에 살면 한쪽만 올린 날 실행기가 manifest와 다른 gh를 싣는다.
 *
 * SRS 9.8절이 실측 기준으로 적은 버전이 `2.97.0`(2026-07-31)이다. 자산 해시는
 * 공식 릴리스의 `gh_2.97.0_checksums.txt`에서 옮겼고, 바이너리 해시는 그 아카이브를
 * 풀어 잰 값이다 (2026-09-13 실측).
 *
 * **`latest`로 올리지 않는다.** 버전을 올리는 것은 manifest를 다시 만들고 의미
 * 오버라이드를 다시 검토하는 일이며, 그것은 별도 CR이다.
 */

export const GH_PINNED_VERSION = '2.97.0' as const;
export const GH_PINNED_RELEASE_DATE = '2026-07-31' as const;

export interface GhPinnedAsset {
  /** 공식 릴리스 자산 파일명. */
  readonly file: string;
  /** 자산(tar.gz) 자체의 SHA-256 — `gh_<version>_checksums.txt`의 값. */
  readonly sha256: string;
  /** 아카이브 안 `bin/gh` 실행 파일의 SHA-256. 실행기가 기동 시 대조한다. */
  readonly binarySha256: string;
}

/** 실행기 이미지가 싣는 자산. 리눅스 amd64 하나다 — 이미지가 그것뿐이다. */
export const GH_PINNED_LINUX_AMD64: GhPinnedAsset = {
  file: `gh_${GH_PINNED_VERSION}_linux_amd64.tar.gz`,
  sha256: 'a2c9b8497e1f85b1ad0dfcb78b5a622e098801b8e461e459e88e1ee12f018112',
  binarySha256: '141507c337e8b202ad398550c3b73d72f5af92e86f71665214538a81efd4c409',
};

export const GH_RELEASE_DOWNLOAD_BASE = 'https://github.com/cli/cli/releases/download' as const;

export function ghPinnedAssetUrl(asset: GhPinnedAsset = GH_PINNED_LINUX_AMD64): string {
  return `${GH_RELEASE_DOWNLOAD_BASE}/v${GH_PINNED_VERSION}/${asset.file}`;
}

/**
 * `gh --version`의 첫 줄에서 버전을 뽑는다.
 *
 * 출력 형식은 `gh version 2.97.0 (2026-07-31)`이고 둘째 줄이 릴리스 URL이다.
 * 형식이 다르면 `null`이다 — 모르는 출력을 버전으로 읽지 않는다.
 */
export function parseGhVersionOutput(output: string): string | null {
  const match = /^gh version (\d+\.\d+\.\d+)/m.exec(output);
  return match?.[1] ?? null;
}
