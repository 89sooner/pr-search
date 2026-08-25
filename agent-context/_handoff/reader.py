#!/usr/bin/env python3
"""
Build compact markdown context packs for coding-agent handoff.

Default layout:
  source: agent-context/**/*.md
  output: agent-context/_handoff/

The compact format is intentionally lossy. It preserves routing signals,
important decisions, risks, paths, commands, and dense normalized prose.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable

# 1.1.0: stable hash-based ids, pack-relative path resolution, stale-file sweep,
# faithful code/command preservation. Abbreviation substitution was removed: it
# corrupted paths and commands on the way in and fabricated wrong expansions on
# restore, while saving almost no tokens with modern tokenizers.
# 1.2.0: compact files open with the #hidden tag.
VERSION = "1.2.0"

# Packs are often written inside an Obsidian-indexed folder. A bare `#hidden` on
# line 1 is an Obsidian tag (no space, so not a heading), which lets the vault
# filter compact files out of search and graph views. It carries no pack meaning.
HIDDEN_TAG = "#hidden"

TAG_PATTERNS = [
    ("@todo", re.compile(r"\b(todo|fixme|next|follow[- ]?up|action item|remaining|pending|must|need to|should)\b", re.I)),
    ("@dec", re.compile(r"\b(decision|decided|chosen|accepted|rejected|direction|policy|rule)\b", re.I)),
    ("@risk", re.compile(r"\b(risk|bug|error|failure|blocked|blocker|incident|regression|fragile|warning|caution|issue)\b", re.I)),
    ("@cmd", re.compile(r"(^|\s)(git|npm|pnpm|yarn|python|pip|poetry|docker|kubectl|make|pytest|ruff|mypy|go|cargo|javac|java|gradle|mvn|curl|gh)\s+", re.I)),
    ("@path", re.compile(r"([A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+|https?://\S+|#[0-9]+|[A-Z]+-[0-9]+")),
]

LOW_SIGNAL_PREFIXES = (
    "thank you",
    "thanks",
    "please note",
    "in this document",
    "this document describes",
    "the following",
)

IMPORTANT_NAME_HINTS = (
    "readme",
    "handoff",
    "context",
    "session",
    "architecture",
    "design",
    "decision",
    "adr",
    "plan",
    "roadmap",
    "todo",
    "incident",
    "migration",
    "requirements",
)

@dataclass
class FileRecord:
    id: str
    source_path: str
    compact_path: str
    sha256: str
    bytes: int
    lines: int
    compact_bytes: int
    headings: list[str]
    signals: list[str]
    priority: int
    title: str


def utcStamp() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def sha256Text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


def slugToken(text: str, limit: int = 80) -> str:
    # \w keeps unicode letters so Korean/Japanese titles stay routable.
    cleaned = re.sub(r"[^\w./-]+", "-", text.strip()).strip("-")
    return cleaned[:limit] or "untitled"


def relPath(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def shouldSkip(path: Path, source: Path, output: Path) -> bool:
    parts = set(path.parts)
    if "node_modules" in parts or ".git" in parts or "dist" in parts or "build" in parts:
        return True
    try:
        path.relative_to(output)
        return True
    except ValueError:
        pass
    try:
        path.relative_to(source / "_handoff")
        return True
    except ValueError:
        pass
    return False


def iterMarkdown(source: Path, output: Path) -> list[Path]:
    if not source.exists():
        return []
    files = []
    for path in source.rglob("*.md"):
        if path.is_file() and not shouldSkip(path, source, output):
            files.append(path)
    return sorted(files, key=lambda p: p.as_posix().lower())


def readText(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def normalizeSpaces(text: str) -> str:
    text = text.replace("\t", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def stripMarkdown(line: str) -> str:
    line = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", line)
    line = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1<\2>", line)
    line = line.replace("**", "").replace("__", "").replace("`", "")
    line = re.sub(r"^>\s*", "", line)
    line = re.sub(r"^[-*+]\s+", "", line)
    line = re.sub(r"^\d+[.)]\s+", "", line)
    return normalizeSpaces(line)


def truncateMiddle(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    head = max(20, int(limit * 0.65))
    tail = max(10, limit - head - 5)
    return text[:head].rstrip() + " ... " + text[-tail:].lstrip()


def classifyLine(raw: str) -> str:
    stripped = raw.strip()
    if not stripped:
        return ""
    for tag, pattern in TAG_PATTERNS:
        if pattern.search(stripped):
            return tag
    if re.match(r"^#{1,6}\s+", stripped):
        return "@h"
    if re.match(r"^[-*+]\s+|^\d+[.)]\s+", stripped):
        return "@b"
    return "@p"


def extractSignals(text: str, source_path: str, max_items: int = 24) -> list[str]:
    signals: list[str] = []
    candidates = [source_path]
    candidates.extend(re.findall(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+", text))
    candidates.extend(re.findall(r"\b[A-Za-z][A-Za-z0-9_]{2,}\b", text))
    stop = {"the", "and", "for", "with", "this", "that", "from", "into", "when", "where", "what", "should", "would", "could", "about"}
    seen = set()
    for item in candidates:
        value = item.strip(".,:;()[]{}<>\"'")
        low = value.lower()
        if len(value) < 3 or low in stop or low in seen:
            continue
        if "/" not in value and not re.search(r"[A-Z_0-9]", value) and len(value) < 7:
            continue
        seen.add(low)
        signals.append(value)
        if len(signals) >= max_items:
            break
    return signals


def extractTitleAndHeadings(text: str, fallback: str) -> tuple[str, list[str]]:
    headings = []
    title = fallback
    for line in text.splitlines():
        match = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
        if not match:
            continue
        heading = stripMarkdown(match.group(2))
        if heading:
            headings.append(heading)
            if title == fallback:
                title = heading
        if len(headings) >= 16:
            break
    return title, headings


def priorityFor(path: Path, text: str) -> int:
    # Match hints against the filename only: matching the full path would let
    # the source dir name (e.g. "agent-context") flatten every score.
    name = path.name.lower()
    score = 50
    for idx, hint in enumerate(IMPORTANT_NAME_HINTS):
        if hint in name:
            score -= 15 + max(0, 8 - idx)
    if re.search(r"\b(todo|risk|decision|architecture|requirement|handoff|session)\b", text, re.I):
        score -= 10
    if len(text) > 12000:
        score += 5
    return max(1, min(99, score))


def compactCodeBlock(lang: str, body: str, keep_lines: int) -> list[str]:
    lines = body.strip("\n").splitlines()
    digest = sha256Text(body)[:12]
    kept = lines[:keep_lines]
    compacted = []
    compacted.append(f"@code lang={lang or 'txt'} sha={digest} lines={len(lines)} kept={len(kept)}")
    for line in kept:
        # Preserve indentation and content: code and commands must survive the
        # round trip runnable. Only guard against pathological line lengths.
        clean = line.rstrip().replace("\t", "    ")
        if clean.strip():
            compacted.append("|" + (clean if len(clean) <= 400 else clean[:400] + " ...cut"))
    if len(lines) > len(kept):
        compacted.append(f"|...cut {len(lines) - len(kept)} lines")
    return compacted


def splitCodeFences(text: str) -> list[tuple[str, str, str]]:
    pattern = re.compile(r"```([^\n`]*)\n(.*?)\n```", re.S)
    result: list[tuple[str, str, str]] = []
    pos = 0
    for match in pattern.finditer(text):
        if match.start() > pos:
            result.append(("text", "", text[pos:match.start()]))
        result.append(("code", match.group(1).strip(), match.group(2)))
        pos = match.end()
    tail = text[pos:]
    # An unclosed fence would otherwise leak its body into prose with the
    # language token glued to the first line; treat it as code to EOF.
    open_fence = re.search(r"(?m)^```([^\n`]*)\s*\n(.*)\Z", tail, re.S)
    if open_fence:
        before = tail[: open_fence.start()]
        if before:
            result.append(("text", "", before))
        result.append(("code", open_fence.group(1).strip(), open_fence.group(2)))
    elif tail:
        result.append(("text", "", tail))
    return result


def compactTextBlock(block: str, max_line: int) -> list[str]:
    output = []
    pending_para = []

    def flushPara() -> None:
        if not pending_para:
            return
        joined = normalizeSpaces(" ".join(pending_para))
        pending_para.clear()
        if not joined:
            return
        output.append("@p " + truncateMiddle(joined, max_line))

    for raw in block.splitlines():
        if not raw.strip():
            flushPara()
            continue
        heading = re.match(r"^(#{1,6})\s+(.+?)\s*$", raw.strip())
        if heading:
            flushPara()
            level = len(heading.group(1))
            text = stripMarkdown(heading.group(2))
            output.append(f"@h{level} " + truncateMiddle(text, max_line))
            continue
        tag = classifyLine(raw)
        cleaned = stripMarkdown(raw)
        if not cleaned:
            continue
        low = cleaned.lower()
        if any(low.startswith(prefix) for prefix in LOW_SIGNAL_PREFIXES):
            continue
        if tag in ("@cmd", "@path"):
            # Commands and paths must survive verbatim: no length truncation.
            flushPara()
            output.append(tag + " " + cleaned)
        elif tag in ("@todo", "@dec", "@risk", "@b"):
            flushPara()
            output.append(tag + " " + truncateMiddle(cleaned, max_line))
        else:
            pending_para.append(cleaned)
            if sum(len(x) for x in pending_para) > max_line * 2:
                flushPara()
    flushPara()
    return output


def compactMarkdown(text: str, source_path: str, file_id: str, max_line: int, keep_code_lines: int) -> tuple[str, list[str], list[str], str]:
    title, headings = extractTitleAndHeadings(text, Path(source_path).stem)
    signals = extractSignals(text, source_path)
    lines = [
        HIDDEN_TAG,
        f"# aci:v1 id={file_id} src={source_path}",
        f"@kv sha256={sha256Text(text)} bytes={len(text.encode('utf-8', errors='replace'))} lines={len(text.splitlines())} title={slugToken(title, 120)}",
    ]
    if signals:
        lines.append("@sig " + ";".join(signals))
    for kind, lang, body in splitCodeFences(text):
        if kind == "code":
            lines.extend(compactCodeBlock(lang, body, keep_code_lines))
        else:
            lines.extend(compactTextBlock(body, max_line))
    compact = "\n".join(lines).strip() + "\n"
    return compact, headings, signals, title


def writeIndex(output: Path, source: Path, records: list[FileRecord], root: Path) -> None:
    lines = []
    lines.append("# agent-context-index:v1")
    lines.append(f"generated={utcStamp()}")
    lines.append(f"source_dir={relPath(source, root)}")
    lines.append(f"output_dir={relPath(output, root)}")
    lines.append(f"files={len(records)}")
    lines.append("legend=@hN heading;@p prose;@b bullet;@todo task;@dec decision;@risk risk;@cmd command;@path path-ref;@code code-fence;@sig retrieval-signals;@kv metadata")
    lines.append("")
    lines.append("## read_order")
    for record in sorted(records, key=lambda r: (r.priority, r.source_path)):
        sig = ",".join(record.signals[:8])
        lines.append(f"- {record.id} p={record.priority} src={record.source_path} compact={record.compact_path} title={record.title} sig={sig}")
    lines.append("")
    lines.append("## files")
    for record in records:
        headings = " > ".join(record.headings[:6])
        lines.append(f"### {record.id}")
        lines.append(f"src={record.source_path}")
        lines.append(f"compact={record.compact_path}")
        lines.append(f"sha256={record.sha256}")
        lines.append(f"bytes={record.bytes} compact_bytes={record.compact_bytes} lines={record.lines} priority={record.priority}")
        if headings:
            lines.append(f"heads={headings}")
        if record.signals:
            lines.append("sig=" + ";".join(record.signals))
        lines.append("")
    lines.append("## continuation_protocol")
    lines.append("read this index first; follow read_order; inspect only compact files needed for task; run reader.py search/show/restore when routing is unclear; treat compact context as lossy and repo source as final truth.")
    (output / "context-index.md").write_text("\n".join(lines).strip() + "\n", encoding="utf-8")


def writeManifest(output: Path, source: Path, records: list[FileRecord], root: Path, warnings: list[str]) -> None:
    data = {
        "format": "agent-context-index:v1",
        "version": VERSION,
        "generated": utcStamp(),
        "root": root.as_posix(),
        "source_dir": relPath(source, root),
        "output_dir": relPath(output, root),
        "warnings": warnings,
        "files": [asdict(record) for record in records],
    }
    (output / "manifest.json").write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def restoreCompact(compact_text: str) -> str:
    restored = []
    in_code = False
    for line in compact_text.splitlines():
        if line.strip() == HIDDEN_TAG:
            # Vault-visibility marker, not context. Prose that happened to say
            # "#hidden" is emitted as "@p #hidden", so this never eats content.
            continue
        if line.startswith("# aci:v1"):
            restored.append("# restored context")
            restored.append("")
            restored.append(line)
            restored.append("")
            continue
        if line.startswith("@kv ") or line.startswith("@sig "):
            restored.append("- " + line)
            continue
        heading = re.match(r"^@h([1-6])\s+(.*)$", line)
        if heading:
            if in_code:
                restored.append("```")
                in_code = False
            restored.append("#" * int(heading.group(1)) + " " + heading.group(2))
            continue
        if line.startswith("@code "):
            if in_code:
                restored.append("```")
            lang_match = re.search(r"\blang=(\S+)", line)
            lang = lang_match.group(1) if lang_match else "text"
            restored.append("")
            restored.append(f"<!-- {line} -->")
            restored.append(f"```{lang}")
            in_code = True
            continue
        if line.startswith("|"):
            restored.append(line[1:])
            continue
        if in_code:
            restored.append("```")
            in_code = False
        for tag in ("@p", "@b", "@todo", "@dec", "@risk", "@cmd", "@path"):
            if line.startswith(tag + " "):
                body = line[len(tag) + 1:]
                prefix = "- " if tag != "@p" else ""
                restored.append(prefix + body)
                break
        else:
            restored.append(line)
    if in_code:
        restored.append("```")
    return "\n".join(restored).strip() + "\n"


def loadManifest(output: Path) -> dict:
    manifest_path = output / "manifest.json"
    if not manifest_path.exists():
        raise SystemExit(f"missing manifest: {manifest_path}")
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def findRecord(manifest: dict, file_id: str) -> dict:
    for record in manifest.get("files", []):
        if record.get("id") == file_id:
            return record
    raise SystemExit(f"unknown id: {file_id}")


def resolveCompact(output: Path, manifest: dict, record: dict) -> Path:
    """Locate a compact file even when the repo was moved or cloned since build.

    manifest['root'] is an absolute path from the build machine, so it is only
    a hint; the compact dir next to the manifest is the reliable anchor.
    """
    raw = Path(record["compact_path"])
    # Pack-local anchor first: it sits next to the manifest that was just
    # loaded, so it can never alias another repo's same-named pack the way a
    # cwd- or stale-root-relative path could.
    candidates = [output / "compact" / raw.name]
    if raw.is_absolute():
        candidates.append(raw)
    else:
        candidates.append(Path(manifest.get("root", ".")) / raw)
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise SystemExit(f"compact file not found for {record.get('id')}: {raw.name}")


def commandBuild(args: argparse.Namespace) -> int:
    root = Path(args.root).resolve()
    source = (root / args.source).resolve()
    output = (root / args.output).resolve()
    compact_dir = output / "compact"
    output.mkdir(parents=True, exist_ok=True)
    compact_dir.mkdir(parents=True, exist_ok=True)

    warnings: list[str] = []
    files = iterMarkdown(source, output)
    records: list[FileRecord] = []

    used_ids: set[str] = set()
    for path in files:
        source_rel = relPath(path, root)
        # Ids derive from the source path so they survive adding/removing other
        # files across rebuilds; positional ids silently re-pointed cross-session
        # references ("see f003") at different content.
        digest = sha256Text(source_rel)
        width = 6
        file_id = "f" + digest[:width]
        while file_id in used_ids:
            width += 2
            file_id = "f" + digest[:width]
        used_ids.add(file_id)
        text = readText(path)
        compact, headings, signals, title = compactMarkdown(text, source_rel, file_id, args.max_line, args.keep_code_lines)
        compact_name = f"{file_id}.{slugToken(path.stem, 48)}.ctx.md"
        compact_path = compact_dir / compact_name
        compact_path.write_text(compact, encoding="utf-8")
        records.append(FileRecord(
            id=file_id,
            source_path=source_rel,
            compact_path=relPath(compact_path, root),
            sha256=sha256Text(text),
            bytes=len(text.encode("utf-8", errors="replace")),
            lines=len(text.splitlines()),
            compact_bytes=len(compact.encode("utf-8", errors="replace")),
            headings=headings,
            signals=signals,
            priority=priorityFor(path, text),
            title=slugToken(title, 120),
        ))

    if not files:
        warnings.append(f"no markdown files found under {relPath(source, root)}")

    current_names = {Path(record.compact_path).name for record in records}
    for stale in compact_dir.glob("*.ctx.md"):
        if stale.name not in current_names:
            stale.unlink()
            warnings.append(f"removed stale compact file: {stale.name}")

    restored_dir = output / "restored"
    if restored_dir.exists():
        valid_restored = {f"{r.id}.{Path(r.source_path).stem}.restored.md" for r in records}
        for stale in restored_dir.glob("*.restored.md"):
            if stale.name not in valid_restored:
                stale.unlink()
                warnings.append(f"removed stale restored file: {stale.name}")

    writeIndex(output, source, records, root)
    writeManifest(output, source, records, root, warnings)

    this_script = Path(__file__).resolve()
    target_reader = output / "reader.py"
    try:
        if this_script != target_reader.resolve():
            shutil.copyfile(this_script, target_reader)
            target_reader.chmod(0o755)
    except OSError as exc:
        warnings.append(f"failed to copy reader.py: {exc}")
        writeManifest(output, source, records, root, warnings)

    print(json.dumps({
        "ok": True,
        "files": len(records),
        "index": relPath(output / "context-index.md", root),
        "manifest": relPath(output / "manifest.json", root),
        "compact_dir": relPath(compact_dir, root),
        "warnings": warnings,
    }, indent=2))
    return 0


def commandList(args: argparse.Namespace) -> int:
    output = Path(args.output).resolve()
    manifest = loadManifest(output)
    for record in sorted(manifest.get("files", []), key=lambda r: (r.get("priority", 99), r.get("source_path", ""))):
        print(f"{record['id']} p={record.get('priority')} src={record.get('source_path')} compact={record.get('compact_path')}")
    return 0


def commandSearch(args: argparse.Namespace) -> int:
    output = Path(args.output).resolve()
    manifest = loadManifest(output)
    terms = [t.lower() for t in re.findall(r"\w+", args.query)]
    scored = []
    for record in manifest.get("files", []):
        compact_path = resolveCompact(output, manifest, record)
        text = compact_path.read_text(encoding="utf-8", errors="replace").lower()
        score = sum(text.count(term) for term in terms)
        score += sum(str(record).lower().count(term) for term in terms)
        if score > 0:
            scored.append((score, record))
    for score, record in sorted(scored, key=lambda x: (-x[0], x[1].get("priority", 99)))[: args.limit]:
        print(f"score={score} {record['id']} p={record.get('priority')} src={record.get('source_path')} compact={record.get('compact_path')}")
    return 0


def commandShow(args: argparse.Namespace) -> int:
    output = Path(args.output).resolve()
    manifest = loadManifest(output)
    record = findRecord(manifest, args.id)
    compact_path = resolveCompact(output, manifest, record)
    text = compact_path.read_text(encoding="utf-8", errors="replace")
    if args.restore:
        print(restoreCompact(text), end="")
    else:
        print(text, end="")
    return 0


def commandRestore(args: argparse.Namespace) -> int:
    output = Path(args.output).resolve()
    manifest = loadManifest(output)
    record = findRecord(manifest, args.id)
    compact_path = resolveCompact(output, manifest, record)
    restored_dir = output / "restored"
    restored_dir.mkdir(parents=True, exist_ok=True)
    restored_path = restored_dir / f"{record['id']}.{Path(record['source_path']).stem}.restored.md"
    restored_path.write_text(restoreCompact(compact_path.read_text(encoding="utf-8", errors="replace")), encoding="utf-8")
    print(restored_path.as_posix())
    return 0


def commandRestoreAll(args: argparse.Namespace) -> int:
    output = Path(args.output).resolve()
    manifest = loadManifest(output)
    restored_dir = output / "restored"
    restored_dir.mkdir(parents=True, exist_ok=True)
    for record in manifest.get("files", []):
        compact_path = resolveCompact(output, manifest, record)
        restored_path = restored_dir / f"{record['id']}.{Path(record['source_path']).stem}.restored.md"
        restored_path.write_text(restoreCompact(compact_path.read_text(encoding="utf-8", errors="replace")), encoding="utf-8")
        print(restored_path.as_posix())
    return 0


def buildParser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="build and inspect compact markdown context packs for coding-agent handoff")
    sub = parser.add_subparsers(dest="command", required=True)

    build = sub.add_parser("build", help="build compact handoff pack")
    build.add_argument("--root", default=".", help="repository root")
    build.add_argument("--source", default="agent-context", help="source markdown directory relative to root")
    build.add_argument("--output", default="agent-context/_handoff", help="output directory relative to root")
    build.add_argument("--max-line", type=int, default=220, help="maximum compact prose line length")
    build.add_argument("--keep-code-lines", type=int, default=80, help="maximum lines to keep per code fence")
    build.set_defaults(func=commandBuild)

    list_cmd = sub.add_parser("list", help="list compacted files by read priority")
    list_cmd.add_argument("--output", default="agent-context/_handoff")
    list_cmd.set_defaults(func=commandList)

    search = sub.add_parser("search", help="search compact context")
    search.add_argument("--output", default="agent-context/_handoff")
    search.add_argument("--query", required=True)
    search.add_argument("--limit", type=int, default=10)
    search.set_defaults(func=commandSearch)

    show = sub.add_parser("show", help="show compact context by id")
    show.add_argument("--output", default="agent-context/_handoff")
    show.add_argument("--id", required=True)
    show.add_argument("--restore", action="store_true", help="print readable lossy restoration")
    show.set_defaults(func=commandShow)

    restore = sub.add_parser("restore", help="write readable lossy restoration for one file")
    restore.add_argument("--output", default="agent-context/_handoff")
    restore.add_argument("--id", required=True)
    restore.set_defaults(func=commandRestore)

    restore_all = sub.add_parser("restore-all", help="write readable lossy restorations for all files")
    restore_all.add_argument("--output", default="agent-context/_handoff")
    restore_all.set_defaults(func=commandRestoreAll)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = buildParser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
