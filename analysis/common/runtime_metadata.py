#!/usr/bin/env python3
"""Collect path-free runtime and source metadata for analysis outputs."""

from __future__ import annotations

import hashlib
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_manifest(paths: Iterable[Path], root: Path) -> list[dict[str, str]]:
    rows = []
    for path in sorted((item.resolve() for item in paths), key=lambda item: item.as_posix()):
        rows.append(
            {
                "path": path.relative_to(root.resolve()).as_posix(),
                "sha256": sha256(path),
            }
        )
    return rows


def collect_runtime_metadata(
    source_paths: Iterable[Path],
    source_root: Path,
    r_runtime: dict[str, object] | None = None,
) -> dict[str, object]:
    config = np.__config__.CONFIG
    dependencies = config.get("Build Dependencies", {})
    blas = dependencies.get("blas", {})
    lapack = dependencies.get("lapack", {})
    return {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
        },
        "python": {
            "implementation": platform.python_implementation(),
            "version": platform.python_version(),
        },
        "packages": {
            "numpy": np.__version__,
            "pandas": pd.__version__,
        },
        "numerical_libraries": {
            "blas_name": blas.get("name"),
            "blas_version": blas.get("version"),
            "blas_configuration": blas.get("openblas configuration"),
            "lapack_name": lapack.get("name"),
            "lapack_version": lapack.get("version"),
        },
        "r": r_runtime,
        "source_manifest": source_manifest(source_paths, source_root),
    }

