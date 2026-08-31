#!/usr/bin/env python3
"""미해결 리뷰 전량 계수 (정본, DEV-468).

상한을 키우는 방식은 언젠가 반드시 그 상한에 닿는다 — `last: 100`은
병합 PR이 101개가 된 순간 앞쪽 하나를 조용히 잘랐다. 커서로 끝까지
순회하고, 순회한 수가 totalCount와 같은지 스스로 확인한다.
"""
import json
import subprocess
import sys

QUERY = """
query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 100, states: MERGED, after: $cursor) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        reviewThreads(first: 100) {
          pageInfo { hasNextPage }
          nodes { isResolved }
        }
      }
    }
  }
}
"""


def page(owner: str, name: str, cursor: str | None) -> dict:
    args = ["gh", "api", "graphql", "-f", f"query={QUERY}", "-F", f"owner={owner}", "-F", f"name={name}"]
    if cursor is not None:
        args += ["-F", f"cursor={cursor}"]
    done = subprocess.run(args, capture_output=True, text=True)
    if done.returncode != 0:
        raise SystemExit(done.stderr.strip()[:500])
    return json.loads(done.stdout)["data"]["repository"]["pullRequests"]


def count(owner: str, name: str) -> int:
    cursor, seen, total = None, 0, None
    unresolved: dict[int, int] = {}
    truncated: list[int] = []
    while True:
        prs = page(owner, name, cursor)
        total = prs["totalCount"]
        for node in prs["nodes"]:
            seen += 1
            threads = node["reviewThreads"]
            if threads["pageInfo"]["hasNextPage"]:
                truncated.append(node["number"])
            open_count = sum(1 for t in threads["nodes"] if not t["isResolved"])
            if open_count:
                unresolved[node["number"]] = open_count
        if not prs["pageInfo"]["hasNextPage"]:
            break
        cursor = prs["pageInfo"]["endCursor"]

    # 순회한 수가 totalCount와 다르면 그 답은 신뢰할 수 없다.
    ok = seen == total
    detail = " ".join(f"#{n}({c})" for n, c in sorted(unresolved.items())) or "없음"
    print(f"=== {owner}/{name} ===")
    print(f"병합 PR {total}개 · 순회 {seen}개 · 전량 순회={'예' if ok else '아니다 — 이 답을 쓰지 마라'}")
    print(f"스레드 100개 초과 PR: {truncated or '없음'}")
    print(f"미해결 총 {sum(unresolved.values())}건: {detail}")
    return 0 if ok else 1


if __name__ == "__main__":
    repos = sys.argv[1:] or ["pr-search", "design-system"]
    sys.exit(max(count("89sooner", r) for r in repos))
