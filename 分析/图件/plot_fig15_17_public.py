#!/usr/bin/env python3
"""Generate analytical plots for Fig. 15–17 from package tables."""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "数据" / "处理数据"
OUTPUT = ROOT / "输出" / "分析" / "图件" / "fig15_17"
ORDER = ["Full A+B+C", "w/o C (A+B)", "w/o B (A+C)", "w/o A (B+C)"]
LABELS = {
    "Full A+B+C": "Full A+B+C",
    "w/o C (A+B)": "Without C",
    "w/o B (A+C)": "Without B",
    "w/o A (B+C)": "Without A",
}


def save(fig: plt.Figure, stem: str) -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for suffix in ("png", "svg", "pdf"):
        kwargs = {"dpi": 300} if suffix == "png" else {}
        fig.savefig(OUTPUT / f"{stem}.{suffix}", bbox_inches="tight", **kwargs)
    plt.close(fig)


def fig15(metrics: pd.DataFrame, bootstrap: pd.DataFrame) -> None:
    metrics = metrics.set_index("Configuration").loc[ORDER].reset_index()
    fig = plt.figure(figsize=(9.4, 7.2))
    grid = fig.add_gridspec(2, 3, height_ratios=[1.1, 1.0])
    columns = [("R2", "R²"), ("RMSE_C", "RMSE (°C)"), ("MAE_C", "MAE (°C)")]
    y = np.arange(len(metrics))
    for index, (column, title) in enumerate(columns):
        ax = fig.add_subplot(grid[0, index])
        values = metrics[column].to_numpy(float)
        ax.hlines(y, 0, values, linewidth=1)
        ax.scatter(values, y, s=34)
        for yi, value in zip(y, values):
            ax.text(value, yi, f" {value:.3f}", va="center", fontsize=8)
        ax.set_title(title)
        ax.set_yticks(y)
        ax.set_yticklabels([LABELS[x] for x in metrics["Configuration"]] if index == 0 else [])
        ax.invert_yaxis()
        ax.grid(axis="x", alpha=0.25)
        ax.spines[["top", "right"]].set_visible(False)

    ax = fig.add_subplot(grid[1, :])
    removed = ["A", "B", "C"]
    x = np.arange(len(removed))
    width = 0.34
    b = bootstrap.set_index("RemovedModel")
    rmse = b.loc[removed, "Delta_RMSE_C"].to_numpy(float)
    mae = b.loc[removed, "Delta_MAE_C"].to_numpy(float)
    rmse_low = rmse - b.loc[removed, "Delta_RMSE_CI2.5_C"].to_numpy(float)
    rmse_high = b.loc[removed, "Delta_RMSE_CI97.5_C"].to_numpy(float) - rmse
    mae_low = mae - b.loc[removed, "Delta_MAE_CI2.5_C"].to_numpy(float)
    mae_high = b.loc[removed, "Delta_MAE_CI97.5_C"].to_numpy(float) - mae
    ax.errorbar(x - width / 2, rmse, yerr=[rmse_low, rmse_high], fmt="o", capsize=4, label="ΔRMSE")
    ax.errorbar(x + width / 2, mae, yerr=[mae_low, mae_high], fmt="s", capsize=4, label="ΔMAE")
    ax.axhline(0, linewidth=0.8, linestyle="--")
    ax.set_xticks(x, [f"Remove {value}" for value in removed])
    ax.set_ylabel("Increase relative to full model (°C)")
    ax.grid(axis="y", alpha=0.25)
    ax.legend(frameon=False)
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    save(fig, "fig15_mechanism_ablation_public")


def fig16(rows: pd.DataFrame) -> None:
    selected = rows[(rows["RowID"].between(173, 200)) | (rows["RowID"].between(1083, 1101))].copy()
    selected = selected.sort_values(["CowKey", "RowID"])
    selected["Observation"] = selected.groupby("CowKey").cumcount() + 1
    cows = list(selected["CowKey"].drop_duplicates())
    fig, axes = plt.subplots(1, len(cows), figsize=(10.0, 3.9), sharey=True)
    axes = np.atleast_1d(axes)
    series = [
        ("Actual_C", "Measured", 1.7),
        ("Predicted_Full_ABC_C", "Full A+B+C", 1.5),
        ("Predicted_Without_A_BC_C", "Without A", 1.0),
        ("Predicted_Without_B_AC_C", "Without B", 1.0),
        ("Predicted_Without_C_AB_C", "Without C", 1.0),
    ]
    for ax, cow in zip(axes, cows):
        part = selected[selected["CowKey"] == cow]
        for column, label, width in series:
            ax.plot(part["Observation"], part[column], marker="o" if column == "Actual_C" else None, markersize=3, linewidth=width, label=label)
        ax.set_title(str(cow))
        ax.set_xlabel("Observation order")
        ax.grid(alpha=0.25)
        ax.spines[["top", "right"]].set_visible(False)
    axes[0].set_ylabel("Core temperature (°C)")
    handles, labels = axes[-1].get_legend_handles_labels()
    fig.legend(handles, labels, loc="lower center", ncol=5, frameon=False)
    fig.tight_layout(rect=(0, 0.12, 1, 1))
    save(fig, "fig16_representative_oof_trajectories_public")


def fig17(metrics: pd.DataFrame) -> None:
    metrics = metrics.set_index("Configuration").loc[ORDER]
    full = metrics.loc["Full A+B+C"]
    normalized = pd.DataFrame(index=metrics.index)
    normalized["R²"] = metrics["R2"] / full["R2"]
    normalized["RMSE"] = full["RMSE_C"] / metrics["RMSE_C"]
    normalized["MAE"] = full["MAE_C"] / metrics["MAE_C"]
    normalized["P95 AE"] = full["P95_AE_C"] / metrics["P95_AE_C"]
    normalized["≤0.5 °C"] = metrics["Within_0_5C"] / full["Within_0_5C"]
    normalized = normalized.clip(lower=0, upper=1)
    normalized.to_csv(OUTPUT / "fig17_relative_performance_values.csv", index_label="Configuration", lineterminator="\n")

    categories = list(normalized.columns)
    angles = np.linspace(0, 2 * np.pi, len(categories), endpoint=False)
    angles = np.concatenate([angles, angles[:1]])
    fig, ax = plt.subplots(figsize=(6.4, 6.4), subplot_kw={"projection": "polar"})
    for configuration in ORDER:
        values = normalized.loc[configuration].to_numpy(float)
        values = np.concatenate([values, values[:1]])
        ax.plot(angles, values, linewidth=1.8, label=LABELS[configuration])
        ax.fill(angles, values, alpha=0.05)
    ax.set_xticks(angles[:-1], categories)
    ax.set_ylim(0, 1.05)
    ax.set_yticks([0.25, 0.50, 0.75, 1.00])
    ax.set_yticklabels(["0.25", "0.50", "0.75", "1.00"])
    ax.set_title("Relative performance (full model = 1.0)", pad=22)
    ax.legend(loc="upper right", bbox_to_anchor=(1.35, 1.15), frameon=False)
    fig.tight_layout()
    save(fig, "fig17_relative_performance_public")


def main() -> int:
    metrics = pd.read_csv(DATA / "th_shrc_ablation_metrics.csv")
    bootstrap = pd.read_csv(DATA / "th_shrc_ablation_bootstrap.csv")
    rows = pd.read_csv(DATA / "th_shrc_ablation_oof_predictions.csv")
    required = {"Full A+B+C", "w/o C (A+B)", "w/o B (A+C)", "w/o A (B+C)"}
    if set(metrics["Configuration"]) != required:
        raise RuntimeError("Unexpected ablation configuration set")
    if len(rows) != 503 or rows["RowID"].nunique() != 503:
        raise RuntimeError("Expected 503 unique ablation rows")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    fig15(metrics, bootstrap)
    fig16(rows)
    fig17(metrics)
    expected = [
        "fig15_mechanism_ablation_public",
        "fig16_representative_oof_trajectories_public",
        "fig17_relative_performance_public",
    ]
    for stem in expected:
        for suffix in ("png", "svg", "pdf"):
            path = OUTPUT / f"{stem}.{suffix}"
            if not path.is_file() or path.stat().st_size == 0:
                raise RuntimeError(f"Missing figure output: {path}")
    print(f"Generated {len(expected)} figure groups in {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
