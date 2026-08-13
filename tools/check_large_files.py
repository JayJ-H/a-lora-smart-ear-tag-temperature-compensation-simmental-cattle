#!/usr/bin/env python3
"""Report repository files larger than the distribution thresholds."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FINAL_ART_EXTENSIONS = {".ai", ".eps", ".opj", ".opju", ".pdf", ".png", ".svg", ".tif", ".tiff", ".jpg", ".jpeg"}


def allowed_final_artwork(path: Path) -> bool:
    relative = path.relative_to(ROOT).as_posix()
    in_source_assets = (
        relative.startswith("analysis/manuscript_figures/source_assets/")
        or relative.startswith("分析/论文图源/图源文件/")
    )
    return in_source_assets and path.suffix.lower() in FINAL_ART_EXTENSIONS


warn = []
fail = []
for path in ROOT.rglob("*"):
    if not path.is_file() or ".git" in path.parts:
        continue
    size = path.stat().st_size
    if size > 50 * 1024 * 1024 and not allowed_final_artwork(path):
        fail.append((size, path.relative_to(ROOT)))
    elif size > 25 * 1024 * 1024 and not allowed_final_artwork(path):
        warn.append((size, path.relative_to(ROOT)))
for size, path in sorted(warn, reverse=True):
    print(f"WARN {size} {path.as_posix()}")
for size, path in sorted(fail, reverse=True):
    print(f"FAIL {size} {path.as_posix()}")
print(f"large-file scan: {len(warn)} warning(s), {len(fail)} failure(s)")
raise SystemExit(1 if fail else 0)
