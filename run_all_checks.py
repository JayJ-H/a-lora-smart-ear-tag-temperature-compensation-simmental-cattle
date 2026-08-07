from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "outputs" / "full_verification_results.json"


def run(label: str, relative_command: list[str]) -> dict[str, object]:
    command = [sys.executable, *relative_command]
    environment = os.environ.copy()
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    completed = subprocess.run(command, cwd=ROOT, check=False, env=environment)
    return {
        "label": label,
        "command": "python " + " ".join(relative_command),
        "returncode": completed.returncode,
        "status": "PASS" if completed.returncode == 0 else "FAIL",
    }


def main() -> int:
    checks = [
        run(
            "temperature_selection_trace",
            ["scripts/verify_temperature_selection.py"],
        ),
        run(
            "temperature_stack_reproduction",
            ["scripts/run_temperature_analysis.py", "--verify-docs"],
        ),
        run("mechanism_ablation_reproduction", ["analysis/ablation/run_ablation.py"]),
        run("benchmark_fixed_choice_refit", ["analysis/benchmark_models/replay_benchmark.py"]),
        run("native_stack_shap", ["analysis/interpretability/run_native_stack_shap.py"]),
        run("conditional_shap_verification", ["analysis/interpretability/verify_conditional_shap.py"]),
        run("fig15_17_generation", ["analysis/figures/plot_fig15_17_public.py"]),
        run("unified_result_verification", ["scripts/verify_results.py"]),
        run("system_software_static_tests", ["system_tests/run_system_tests.py"]),
    ]
    failures = [item for item in checks if item["status"] != "PASS"]
    payload = {
        "ok": not failures,
        "passed": len(checks) - len(failures),
        "failed": len(failures),
        "checks": checks,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
