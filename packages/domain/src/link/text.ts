/**
 * 관계 파생이 공유하는 텍스트 전처리 (WP-029·WP-030).
 *
 * `references`·`reverts`가 같은 본문을 읽으므로 마스킹 primitive를 두 벌 만들지
 * 않는다 — 두 벌이면 한쪽만 고쳐지고, 그때 "코드 블록 안의 표현은 추출하지
 * 않는다"(FR-REL-003 AC-4)가 계열마다 다르게 지켜진다.
 */

/** 근거 텍스트 상한. 본문을 문서에 복제하지 않는다. */
export const EVIDENCE_LIMIT = 200;

/**
 * 코드 블록·인라인 코드·인용 구간을 **같은 길이의 공백으로** 덮는다 (FR-REL-003 AC-4).
 *
 * 지우지 않고 덮는 이유는 오프셋이 그대로 남아야 근거 텍스트를 원문에서 잘라낼
 * 수 있기 때문이다. Markdown 렌더러를 새로 구현하지는 않는다 — AC-4가 요구하는
 * 세 구간만 정확히 처리한다.
 */
export function maskExcluded(text: string): string {
  const lines = text.split('\n');
  let fence: string | null = null;
  const out: string[] = [];

  for (const line of lines) {
    const opener = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);

    if (fence !== null) {
      // 닫는 울타리는 같은 문자이고 열 때보다 짧지 않아야 한다 (CommonMark).
      if (opener !== null && opener[1]!.startsWith(fence[0]!) && opener[1]!.length >= fence.length) {
        fence = null;
      }
      out.push(blank(line));
      continue;
    }
    if (opener !== null) {
      fence = opener[1]!;
      out.push(blank(line));
      continue;
    }
    if (/^[ \t]{0,3}>/.test(line)) {
      out.push(blank(line));
      continue;
    }
    out.push(maskInlineCode(line));
  }

  return out.join('\n');
}

function blank(line: string): string {
  return ' '.repeat(line.length);
}

/**
 * 인라인 코드 스팬을 덮는다.
 *
 * 여는 백틱 N개는 **정확히 N개**인 다음 백틱 묶음이 닫는다 (CommonMark).
 * 짝이 없으면 코드가 아니므로 덮지 않는다.
 */
function maskInlineCode(line: string): string {
  const runs: Array<{ readonly start: number; readonly length: number }> = [];
  const pattern = /`+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    runs.push({ start: match.index, length: match[0].length });
  }
  if (runs.length < 2) return line;

  const chars = line.split('');
  let index = 0;
  while (index < runs.length) {
    const open = runs[index]!;
    let close = index + 1;
    while (close < runs.length && runs[close]!.length !== open.length) close += 1;
    if (close >= runs.length) break;
    const end = runs[close]!.start + runs[close]!.length;
    for (let position = open.start; position < end; position += 1) chars[position] = ' ';
    index = close + 1;
  }
  return chars.join('');
}

/** 오프셋이 속한 줄을 원문에서 잘라 근거로 만든다. 길면 자른다. */
export function evidenceLine(original: string, offset: number): string {
  const start = original.lastIndexOf('\n', offset) + 1;
  const stop = original.indexOf('\n', offset);
  const line = original.slice(start, stop === -1 ? original.length : stop).trim();
  return line.length <= EVIDENCE_LIMIT ? line : `${line.slice(0, EVIDENCE_LIMIT - 1)}\u2026`;
}

/** 커밋 메시지의 제목 줄. git의 `%s`와 같은 것 — 첫 줄이다. */
export function commitSubject(message: string): string {
  const stop = message.indexOf('\n');
  return (stop === -1 ? message : message.slice(0, stop)).trim();
}
