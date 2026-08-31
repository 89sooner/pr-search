#!/usr/bin/env python3
"""미해결 리뷰 전량 계수 (정본, DEV-468·DEV-469).

상한을 키우는 방식은 언젠가 반드시 그 상한에 닿는다 — `last: 100`은
병합 PR이 101개가 된 순간 앞쪽 하나를 조용히 잘랐다.

창은 **둘**이다. 병합 PR 목록과 각 PR의 리뷰 스레드 목록이며, 둘 다
커서로 끝까지 순회한다. 안쪽 창을 "잘렸다"고 보고만 하고 판정에 넣지
않으면 그 PR의 두 번째 페이지에 있는 미해결 리뷰가 0건으로 보고된다
(DEV-469).

순회한 수가 각 `totalCount`와 같은지 스스로 확인하고, 다르면 그 답을
쓰지 말라고 말하며 종료 코드 1을 낸다.
"""
import json
import subprocess
import sys

PR_PAGE = """
query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 50, states: MERGED, after: $cursor) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        reviewThreads(first: 100) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes { isResolved }
        }
      }
    }
  }
}
"""

THREAD_PAGE = """
query($owner: String!, $name: String!, $number: Int!, $cursor: String!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { isResolved }
      }
    }
  }
}
"""


def graphql(query: str, **variables: object) -> dict:
    args = ["gh", "api", "graphql", "-f", f"query={query}"]
    for key, value in variables.items():
        args += ["-F", f"{key}={value}"]
    done = subprocess.run(args, capture_output=True, text=True)
    if done.returncode != 0:
        raise SystemExit(done.stderr.strip()[:500])
    return json.loads(done.stdout)


def count_threads(owner: str, name: str, number: int, first: dict) -> tuple[int, int]:
    """한 PR의 스레드를 끝까지 센다. 반환은 (미해결 수, 순회한 스레드 수)."""
    unresolved = sum(1 for t in first["nodes"] if not t["isResolved"])
    seen = len(first["nodes"])
    page = first
    while page["pageInfo"]["hasNextPage"]:
        data = graphql(
            THREAD_PAGE, owner=owner, name=name, number=number, cursor=page["pageInfo"]["endCursor"]
        )
        page = data["data"]["repository"]["pullRequest"]["reviewThreads"]
        unresolved += sum(1 for t in page["nodes"] if not t["isResolved"])
        seen += len(page["nodes"])
    return unresolved, seen


def count(owner: str, name: str) -> int:
    cursor: str | None = None
    seen_prs = 0
    total_prs: int | None = None
    unresolved: dict[int, int] = {}
    short_threads: list[int] = []

    while True:
        data = (
            graphql(PR_PAGE, owner=owner, name=name, cursor=cursor)
            if cursor is not None
            else graphql(PR_PAGE, owner=owner, name=name)
        )
        prs = data["data"]["repository"]["pullRequests"]
        total_prs = prs["totalCount"]
        for node in prs["nodes"]:
            seen_prs += 1
            number = node["number"]
            threads = node["reviewThreads"]
            open_count, seen_threads = count_threads(owner, name, number, threads)
            # 스레드도 전량을 봤는지 각 PR마다 확인한다 (DEV-469).
            if seen_threads != threads["totalCount"]:
                short_threads.append(number)
            if open_count:
                unresolved[number] = open_count
        if not prs["pageInfo"]["hasNextPage"]:
            break
        cursor = prs["pageInfo"]["endCursor"]

    ok = seen_prs == total_prs and not short_threads
    detail = " ".join(f"#{n}({c})" for n, c in sorted(unresolved.items())) or "없음"
    print(f"=== {owner}/{name} ===")
    print(f"병합 PR {total_prs}개 · 순회 {seen_prs}개")
    if short_threads:
        print(f"스레드를 다 세지 못한 PR: {short_threads}")
    print(f"전량 순회={'예' if ok else '아니다 — 이 답을 쓰지 마라'}")
    print(f"미해결 총 {sum(unresolved.values())}건: {detail}")
    return 0 if ok else 1


if __name__ == "__main__":
    repos = sys.argv[1:] or ["pr-search", "design-system"]
    sys.exit(max(count("89sooner", repo) for repo in repos))
