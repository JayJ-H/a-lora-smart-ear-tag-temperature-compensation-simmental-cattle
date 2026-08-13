#!/usr/bin/env python3
"""Validate repository structure and common packaging errors."""

from __future__ import annotations

import csv
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEXT_SUFFIXES = {
    ".md", ".txt", ".py", ".r", ".js", ".mjs", ".ts", ".vue",
    ".json", ".yaml", ".yml", ".csv", ".sql", ".xml", ".html",
    ".css", ".scss", ".toml", ".ini", ".cfg", ".cpp", ".h",
}
TEMP_PATH_PATTERNS = (
    re.compile(r"(?i)(?:^|[\/])(?:tmp|temp)(?:[\/]|$)"),
    re.compile(r"(?i)[A-Z]:[\/](?:Users|Documents|Desktop|Downloads|workspace|project)[\/]"),
    re.compile(r"(?i)/(?:home|users)/[^/\s]+/"),
)
FINAL_ART_EXTENSIONS = {".ai", ".eps", ".opj", ".opju", ".pdf", ".png", ".svg", ".tif", ".tiff", ".jpg", ".jpeg"}
REQUIRED = ['README.md', 'REPRODUCE.md', 'LICENSE_NOTICE.md', '数据/处理数据/th_shrc_oof_predictions.csv', '数据/处理数据/th_shrc_ablation_oof_predictions.csv', '数据/匿名质控数据/lora_packet_level_quality_controlled.csv', '分析/图件/plot_fig15_17_public.py', '固件/耳标/main/main.cpp', '固件/网关/main/main.cpp', '硬件/耳标/PCB/ear_tag_easyeda_project.epro2', '硬件/网关/PCB/gateway_easyeda_project.epro2', '管理系统/reference/schema.sql']


def iter_text_files() -> list[Path]:
    return [
        path for path in ROOT.rglob("*")
        if path.is_file()
        and (path.suffix.lower() in TEXT_SUFFIXES or path.name in {"CMakeLists.txt", "requirements.txt"})
    ]


def compiled_artifacts() -> list[str]:
    findings = []
    for path in ROOT.rglob("*"):
        if path.is_dir() and path.name == "__pycache__":
            findings.append(path.relative_to(ROOT).as_posix())
        elif path.is_file() and path.suffix.lower() in {".pyc", ".pyo"}:
            findings.append(path.relative_to(ROOT).as_posix())
    return findings


def temporary_paths() -> list[str]:
    findings = []
    for path in iter_text_files():
        if path.name == "check_repository_integrity.py":
            continue
        try:
            text = path.read_text(encoding="utf-8-sig")
        except UnicodeDecodeError:
            continue
        for line_no, line in enumerate(text.splitlines(), start=1):
            normalized = line.replace("\\", "/")
            if path.name == "clean-dev.ts" and "src/mock/temp/" in normalized:
                continue
            if any(pattern.search(line) for pattern in TEMP_PATH_PATTERNS):
                findings.append(f"{path.relative_to(ROOT).as_posix()}:{line_no}")
    return findings


def markdown_links() -> list[str]:
    findings = []
    pattern = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
    for path in ROOT.rglob("*.md"):
        text = path.read_text(encoding="utf-8-sig")
        for target in pattern.findall(text):
            target = target.strip().split("#", 1)[0].strip("<>")
            if not target or re.match(r"^[a-z]+://", target, re.I) or target.startswith("mailto:"):
                continue
            resolved = (path.parent / target).resolve()
            try:
                resolved.relative_to(ROOT.resolve())
            except ValueError:
                findings.append(f"{path.relative_to(ROOT).as_posix()}:{target}:outside-root")
                continue
            if not resolved.exists():
                findings.append(f"{path.relative_to(ROOT).as_posix()}:{target}:missing")
    return findings


def structured_files() -> list[str]:
    findings = []
    for path in ROOT.rglob("*.json"):
        try:
            json.loads(path.read_text(encoding="utf-8-sig"))
        except Exception as exc:
            findings.append(f"{path.relative_to(ROOT).as_posix()}:{exc}")
    for path in ROOT.rglob("*.csv"):
        try:
            with path.open("r", encoding="utf-8-sig", newline="") as handle:
                reader = csv.reader(handle)
                header = next(reader, [])
                if len(header) != len(set(header)):
                    findings.append(f"{path.relative_to(ROOT).as_posix()}:duplicate-header")
                for _ in reader:
                    pass
        except Exception as exc:
            findings.append(f"{path.relative_to(ROOT).as_posix()}:{exc}")
    return findings


def allowed_large_artwork(path: Path) -> bool:
    relative = path.relative_to(ROOT).as_posix()
    in_source_assets = (
        relative.startswith("analysis/manuscript_figures/source_assets/")
        or relative.startswith("分析/论文图源/图源文件/")
    )
    return in_source_assets and path.suffix.lower() in FINAL_ART_EXTENSIONS


def large_files() -> list[str]:
    return [
        f"{path.relative_to(ROOT).as_posix()}:{path.stat().st_size}"
        for path in ROOT.rglob("*")
        if path.is_file()
        and ".git" not in path.relative_to(ROOT).parts
        and path.stat().st_size > 50 * 1024 * 1024
        and not allowed_large_artwork(path)
    ]


def archive_members() -> list[str]:
    findings = []
    for path in ROOT.rglob("*.zip"):
        try:
            with zipfile.ZipFile(path) as archive:
                names = archive.namelist()
                if len(names) != len(set(names)):
                    findings.append(f"{path.relative_to(ROOT).as_posix()}:duplicate-member")
                for info in archive.infolist():
                    parts = Path(info.filename.replace("\\", "/")).parts
                    if info.filename.startswith("/") or ".." in parts:
                        findings.append(f"{path.relative_to(ROOT).as_posix()}:{info.filename}:unsafe-path")
                    if info.flag_bits & 0x1:
                        findings.append(f"{path.relative_to(ROOT).as_posix()}:{info.filename}:encrypted")
        except zipfile.BadZipFile as exc:
            findings.append(f"{path.relative_to(ROOT).as_posix()}:{exc}")
    return findings


def required_files() -> list[str]:
    return [relative for relative in REQUIRED if not (ROOT / relative).is_file()]


def main() -> int:
    checks = {
        "compiled_artifacts": compiled_artifacts(),
        "temporary_paths": temporary_paths(),
        "broken_markdown_links": markdown_links(),
        "structured_file_errors": structured_files(),
        "archive_errors": archive_members(),
        "files_over_50_mib": large_files(),
        "missing_required_files": required_files(),
    }
    ok = all(not findings for findings in checks.values())
    payload = {"ok": ok, "checks": checks}
    output = ROOT / ("输出" if (ROOT / "数据").is_dir() else "outputs") / "repository_integrity.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"ok": ok, "finding_counts": {name: len(items) for name, items in checks.items()}}, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
