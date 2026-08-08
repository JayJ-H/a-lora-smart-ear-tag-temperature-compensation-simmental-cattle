from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
import os
import shutil
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "输出"


@dataclass
class Result:
    test_id: str
    status: str
    required: bool
    detail: str


def encode(device_id: int, ear: int, ambient: int) -> bytes:
    if not 51 <= device_id <= 85:
        raise ValueError("device id outside public range")
    if not 0 <= ear <= 400 or not 0 <= ambient <= 400:
        raise ValueError("temperature code outside public range")
    packed = ((device_id - 51) << 18) | (ear << 9) | ambient
    return packed.to_bytes(3, "big")


def decode(payload: bytes) -> tuple[int, int, int]:
    if len(payload) != 3:
        raise ValueError("payload length must be 3")
    packed = int.from_bytes(payload, "big")
    code = (packed >> 18) & 0x3F
    if code > 34:
        raise ValueError("device code outside receiver range")
    return 51 + code, (packed >> 9) & 0x1FF, packed & 0x1FF


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def matches_manifest(path: Path, expected_size: int, expected_hash: str) -> bool:
    data = path.read_bytes()
    candidates = [data]
    if b"\x00" not in data:
        try:
            data.decode("utf-8-sig")
        except UnicodeDecodeError:
            pass
        else:
            lf_data = data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
            candidates.extend([lf_data, lf_data.replace(b"\n", b"\r\n")])
    return any(
        len(candidate) == expected_size
        and hashlib.sha256(candidate).hexdigest() == expected_hash
        for candidate in candidates
    )


def normalized(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"//[^\r\n]*", "", text)
    return re.sub(r"\s+", "", text)


def run(results: list[Result], test_id: str, fn: Callable[[], str]) -> None:
    try:
        detail = fn()
    except Exception as exc:
        results.append(Result(test_id, "FAIL", True, str(exc)))
    else:
        results.append(Result(test_id, "PASS", True, detail))


def known_vectors() -> str:
    vectors = [(51, 0, 0, "000000"), (83, 386, 398, "83058e"), (85, 400, 400, "8b2190")]
    for device, ear, ambient, expected in vectors:
        if encode(device, ear, ambient).hex() != expected:
            raise AssertionError(f"vector mismatch: {device}")
        if decode(bytes.fromhex(expected)) != (device, ear, ambient):
            raise AssertionError(f"decode mismatch: {device}")
    return "3 个固定向量一致"


def roundtrips() -> str:
    values = [0, 1, 37, 123, 250, 399, 400]
    n = 0
    for device in range(51, 86):
        for ear in values:
            for ambient in values:
                if decode(encode(device, ear, ambient)) != (device, ear, ambient):
                    raise AssertionError("roundtrip mismatch")
                n += 1
    return f"{n} 次往返编码一致"


def radio_alignment() -> str:
    ear = normalized(ROOT / "固件/耳标/main/main.cpp")
    gateway = normalized(ROOT / "固件/网关/main/lora_driver.cpp")
    signatures = [
        (ear, "radio.begin(433.0,31.25,12,7,0x34,LORA_TX_POWER_DBM,12,0)"),
        (gateway, "s_radio->begin(433.0,31.25,12,7,0x34,20,12,0)"),
    ]
    for source, signature in signatures:
        if signature not in source or "setCRC(true)" not in source or "explicitHeader()" not in source:
            raise AssertionError("radio parameter mismatch")
    return "频率、带宽、扩频因子、编码率、同步字、前导码、报头和 CRC 一致"


def firmware_boundary() -> str:
    source = (ROOT / "固件/耳标/main/main.cpp").read_text(encoding="utf-8")
    if not re.search(r"^#define\s+DEVICE_ID\s+51\b", source, flags=re.M):
        raise AssertionError("example device ID 51 missing")
    if not re.search(r"^#define\s+WAKEUP_SEC\s+\d+\b", source, flags=re.M):
        raise AssertionError("wake interval constant missing")
    required = [
        ROOT / "固件/耳标/CMakeLists.txt",
        ROOT / "固件/耳标/main/CMakeLists.txt",
        ROOT / "固件/网关/CMakeLists.txt",
        ROOT / "固件/网关/main/CMakeLists.txt",
    ]
    if any(not path.is_file() for path in required):
        raise AssertionError("ESP-IDF project files missing")
    return "耳标与网关 ESP-IDF 源码及配置常量验证通过"

def asset_manifest() -> str:
    manifest = ROOT / "system_asset_manifest.csv"
    with manifest.open("r", encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    expected = {
        p.relative_to(ROOT).as_posix()
        for folder in ("硬件", "固件", "管理系统")
        for p in (ROOT / folder).rglob("*") if p.is_file()
    }
    listed = {row["path"] for row in rows}
    if expected != listed or len(rows) != len(listed):
        raise AssertionError("asset manifest coverage mismatch")
    for row in rows:
        path = ROOT / row["path"]
        expected_size = int(row["bytes"])
        expected_hash = row["sha256"]
        if not matches_manifest(path, expected_size, expected_hash):
            raise AssertionError(
                f"asset hash mismatch: {row['path']} "
                f"actual_bytes={path.stat().st_size} expected_bytes={expected_size} "
                f"actual_sha256={sha256(path)} expected_sha256={expected_hash}"
            )
    return f"{len(rows)} 个资产哈希验证通过"


def backend_reference() -> str:
    required = [
        "管理系统/README.md",
        "管理系统/reference/schema.sql",
        "管理系统/reference/API_REFERENCE.md",
        "管理系统/reference/ID_MAPPING_AND_INGESTION.md",
        "管理系统/reference/ALERT_RULES.md",
        "管理系统/reference/MODEL_INTEGRATION_STATUS.md",
        "管理系统/reference/web_interface_manifest.csv",
    ]
    for rel in required:
        if not (ROOT / rel).is_file():
            raise AssertionError(f"missing backend reference: {rel}")
    schema = (ROOT / "管理系统/reference/schema.sql").read_text(encoding="utf-8")
    tables = ["animal_profile", "tag_registry", "animal_tag_assignment", "thermal_reading", "link_metric", "mqtt_message_log", "alert_case", "gateway_control_log"]
    for table in tables:
        if f"CREATE TABLE {table}" not in schema:
            raise AssertionError(f"missing table: {table}")
    return "后台表结构及接口文件验证通过"



def backend_platform() -> str:
    required = [
        "管理系统/源代码/package.json",
        "管理系统/源代码/pnpm-lock.yaml",
        "管理系统/源代码/.env.example",
        "管理系统/源代码/LICENSE",
        "管理系统/源代码/脚本/mysql-backend-server.mjs",
        "管理系统/源代码/脚本/th-shrc-runtime.mjs",
        "管理系统/源代码/脚本/validate-th-shrc-runtime.mjs",
        "管理系统/源代码/脚本/assets/th-shrc/runtime-model-v2-exact.json",
        "管理系统/源代码/数据库/mysql/init/001_init_schema.sql",
        "管理系统/源代码/数据库/mysql/init/002_event_sync_triggers.sql",
        "管理系统/源代码/运维/生产配置/docker-compose.prod.yml",
        "管理系统/源代码/src/main.ts",
    ]
    missing = [relative for relative in required if not (ROOT / relative).is_file()]
    if missing:
        raise AssertionError("missing platform files: " + ", ".join(missing))
    return f"{len(required)} 个完整平台源码入口验证通过"


def mysql_bootstrap() -> str:
    init_dir = ROOT / "管理系统/源代码/数据库/mysql/init"
    sql_files = sorted(path.name for path in init_dir.glob("*.sql"))
    expected_sql = {
        "001_init_schema.sql",
        "002_event_sync_triggers.sql",
    }
    if set(sql_files) != expected_sql:
        raise AssertionError(f"unexpected bootstrap SQL files: {sql_files}")
    schema = (init_dir / "001_init_schema.sql").read_text(encoding="utf-8")
    triggers = (init_dir / "002_event_sync_triggers.sql").read_text(encoding="utf-8")
    if "cattle_management" not in schema or "USE cattle_management" not in triggers:
        raise AssertionError("bootstrap database names are not aligned")
    compose = (ROOT / "管理系统/源代码/数据库/mysql/docker-compose.local.yml").read_text(encoding="utf-8")
    if "./init:/docker-entrypoint-initdb.d:ro" not in compose:
        raise AssertionError("local MySQL bootstrap mount missing")
    return "cattle_management 数据库初始化链验证通过"


def node_syntax() -> str:
    node = shutil.which("node")
    if not node:
        raise AssertionError("Node.js executable not found")
    source_root = ROOT / "管理系统/源代码"
    scripts = sorted(
        path for path in source_root.rglob("*")
        if path.is_file() and path.suffix.lower() in {".js", ".mjs", ".cjs"}
    )
    if not scripts:
        raise AssertionError("no JavaScript sources found")
    for script in scripts:
        completed = subprocess.run(
            [node, "--check", str(script)],
            cwd=source_root,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
        )
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout).strip()
            raise AssertionError(f"{script.relative_to(source_root)}: {detail[:300]}")
    return f"{len(scripts)} 个文件通过 Node 语法检查"


def runtime_timezone() -> str:
    node = shutil.which("node")
    if not node:
        raise AssertionError("Node.js executable not found")
    source_root = ROOT / "管理系统/源代码"
    script = source_root / "脚本/validate-th-shrc-runtime.mjs"
    for timezone in ("UTC", "Asia/Shanghai"):
        environment = os.environ.copy()
        environment["TZ"] = timezone
        completed = subprocess.run(
            [node, str(script)],
            cwd=source_root,
            env=environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
        )
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout).strip()
            raise AssertionError(f"runtime validation failed in {timezone}: {detail[:400]}")
    return "TH-SHRC 运行时在 UTC 和 Asia/Shanghai 时区验证通过"


def package_scripts() -> str:
    package_path = ROOT / "管理系统/源代码/package.json"
    payload = json.loads(package_path.read_text(encoding="utf-8"))
    if payload.get("packageManager") != "pnpm@8.15.9":
        raise AssertionError("pnpm version is not pinned")
    root = package_path.parent
    missing = []
    pattern = re.compile(r"(?:(?:scripts|ops|database|src|public)[/\\][^\s\"']+)")
    for name, command in payload.get("scripts", {}).items():
        for token in pattern.findall(command):
            normalized_token = token.replace("\\\\", "/").rstrip(";,)")
            if normalized_token.endswith(".env.prod"):
                continue
            if not (root / normalized_token).exists():
                missing.append(f"{name}:{normalized_token}")
    if missing:
        raise AssertionError("missing package-script paths: " + ", ".join(missing[:10]))
    return f"已检查 {len(payload.get('scripts', {}))} 个 package 脚本"


def production_template() -> str:
    root = ROOT / "管理系统/源代码"
    caddy = (root / "运维/生产配置/Caddyfile").read_text(encoding="utf-8")
    if "{$PUBLIC_HOST:localhost}" not in caddy:
        raise AssertionError("Caddy host is not environment-configurable")
    return "部署配置验证通过"

def write_reports(results: list[Result]) -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    payload = {"ok": all(r.status == "PASS" for r in results if r.required), "results": [asdict(r) for r in results]}
    (OUTPUT / "system_test_results.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    with (OUTPUT / "system_test_results.csv").open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["test_id", "status", "required", "detail"], lineterminator="\n")
        writer.writeheader(); writer.writerows(asdict(r) for r in results)
    lines = ["# 系统静态检查", "", f"总体：**{'PASS' if payload['ok'] else 'FAIL'}**", "", "| 检查项 | 状态 | 说明 |", "|---|---|---|"]
    for r in results:
        lines.append(f"| `{r.test_id}` | {r.status} | {r.detail.replace('|', '\\|')} |")
    (OUTPUT / "system_test_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    results: list[Result] = []
    for test_id, fn in [
        ("protocol_known_vectors", known_vectors),
        ("protocol_roundtrips", roundtrips),
        ("radio_parameter_alignment", radio_alignment),
        ("firmware_sources", firmware_boundary),
        ("system_asset_manifest", asset_manifest),
        ("backend_reference", backend_reference),
        ("backend_platform", backend_platform),
        ("mysql_bootstrap", mysql_bootstrap),
        ("node_syntax", node_syntax),
        ("th_shrc_runtime_timezone", runtime_timezone),
        ("package_script_paths", package_scripts),
        ("production_template", production_template),
    ]:
        run(results, test_id, fn)
    write_reports(results)
    ok = all(r.status == "PASS" for r in results if r.required)
    for result in results:
        print(f"[{result.status}] {result.test_id}: {result.detail}")
    print(json.dumps({"ok": ok, "pass": sum(r.status == 'PASS' for r in results), "fail": sum(r.status == 'FAIL' for r in results)}, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
