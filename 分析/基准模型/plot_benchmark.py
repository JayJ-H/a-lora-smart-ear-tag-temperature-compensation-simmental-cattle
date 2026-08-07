from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.lines import Line2D


plt.rcParams["font.family"] = "sans-serif"
plt.rcParams["font.sans-serif"] = ["Arial", "DejaVu Sans", "Liberation Sans"]
plt.rcParams["svg.fonttype"] = "none"
plt.rcParams["pdf.fonttype"] = 42
plt.rcParams["font.size"] = 6.5
plt.rcParams["axes.linewidth"] = 0.6
plt.rcParams["axes.spines.top"] = False
plt.rcParams["axes.spines.right"] = False
plt.rcParams["xtick.major.width"] = 0.5
plt.rcParams["ytick.major.width"] = 0.5


SHARED_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BENCHMARK_OUTPUT = SHARED_ROOT / "输出" / "分析" / "基准模型"


GROUP_LABELS = {
    "proposed_model_reference": "Proposed stack",
    "evolutionary_optimized_ml": "Evolutionary optimized ML",
    "conventional_ml": "Conventional ML",
    "linear_baseline": "Linear / baseline",
}

GROUP_COLORS = {
    "proposed_model_reference": "#0F4D92",
    "evolutionary_optimized_ml": "#42949E",
    "conventional_ml": "#767676",
    "linear_baseline": "#CFCECE",
}

GROUP_MARKERS = {
    "proposed_model_reference": "*",
    "evolutionary_optimized_ml": "^",
    "conventional_ml": "o",
    "linear_baseline": "s",
}

EXCLUDED_FROM_MAIN_FIGURE = {"MLP", "SGD_Huber", "KernelRidge_RBF"}


def short_name(name: str) -> str:
    replacements = {
        "StrictThreeModelStack_reference": "StrictThreeModelStack",
        "DE_XGBoost": "DE-XGBoost",
        "DE_GradientBoosting": "DE-GradientBoosting",
        "PSO_RandomForest": "PSO-RandomForest",
        "GWO_ExtraTrees": "GWO-ExtraTrees",
        "GA_SVR_RBF": "GA-SVR",
        "SA_KNN": "SA-KNN",
        "KNN_k5": "KNN",
        "KernelRidge_RBF": "KernelRidge",
        "SplineRidge_GAMLike": "SplineRidge",
        "HistGradientBoosting": "HistGBM",
        "GaussianProcess_RBF": "GaussianProcess",
        "PolynomialRidge": "PolyRidge",
        "MultipleLinear": "Linear",
    }
    return replacements.get(name, name)


def load_summary(table_path: Path) -> pd.DataFrame:
    df = pd.read_csv(table_path)
    needed = ["Model", "BenchmarkGroup", "R2", "RMSE", "MAE", "Within_0_2C"]
    missing = [col for col in needed if col not in df.columns]
    if missing:
        raise ValueError(f"Missing columns in {table_path}: {missing}")
    df = df.copy()
    df["ModelShort"] = df["Model"].map(short_name)
    df["GroupLabel"] = df["BenchmarkGroup"].map(GROUP_LABELS)
    df["GroupColor"] = df["BenchmarkGroup"].map(GROUP_COLORS)
    return df.sort_values(["R2", "RMSE"], ascending=[False, True]).reset_index(drop=True)


def panel_label(ax, label: str) -> None:
    ax.text(
        -0.08,
        1.04,
        label,
        transform=ax.transAxes,
        ha="left",
        va="bottom",
        fontsize=8,
        fontweight="bold",
    )


def draw_r2_ranking(ax, df: pd.DataFrame) -> None:
    rank_df = df.sort_values("R2", ascending=True).reset_index(drop=True)
    y = np.arange(len(rank_df))
    ax.barh(y, rank_df["R2"], color=rank_df["GroupColor"], height=0.72, edgecolor="none")
    ax.axvline(0, color="#B0B0B0", lw=0.7)
    ax.set_yticks(y)
    ax.set_yticklabels(rank_df["ModelShort"], fontsize=5.4)
    ax.set_xlabel("Out-of-fold R2")
    ax.set_title("All-model ranking", loc="left", fontsize=7.5, fontweight="bold")
    ax.set_xlim(min(-0.08, float(rank_df["R2"].min()) - 0.04), 0.91)
    ax.grid(axis="x", color="#E6E6E6", lw=0.5)
    ax.set_axisbelow(True)
    for i, (_, row) in enumerate(rank_df.iterrows()):
        value = float(row["R2"])
        x = value + 0.012 if value >= 0 else 0.012
        ax.text(x, i, f"{value:.2f}", va="center", ha="left", fontsize=4.8, color="#303030")
    panel_label(ax, "a")


def draw_pareto(ax, df: pd.DataFrame) -> None:
    for group, group_df in df.groupby("BenchmarkGroup", sort=False):
        size = 170 if group == "proposed_model_reference" else 42
        marker = GROUP_MARKERS[group]
        ax.scatter(
            group_df["RMSE"],
            group_df["MAE"],
            s=size,
            marker=marker,
            color=GROUP_COLORS[group],
            edgecolor="white",
            linewidth=0.55,
            zorder=3 if group == "proposed_model_reference" else 2,
        )
    ax.set_xlabel("RMSE (C)")
    ax.set_ylabel("MAE (C)")
    ax.set_title("Error Pareto space", loc="left", fontsize=7.5, fontweight="bold")
    ax.grid(color="#E8E8E8", lw=0.5)
    ax.set_axisbelow(True)

    labels = ["StrictThreeModelStack_reference", "DE_XGBoost", "LightGBM", "PolynomialRidge"]
    offsets = {
        "StrictThreeModelStack_reference": (0.012, 0.016),
        "DE_XGBoost": (0.012, -0.006),
        "LightGBM": (0.012, 0.006),
        "PolynomialRidge": (0.012, 0.010),
    }
    for model in labels:
        row = df.loc[df["Model"] == model]
        if row.empty:
            continue
        row = row.iloc[0]
        dx, dy = offsets[model]
        ax.annotate(
            short_name(model),
            xy=(row["RMSE"], row["MAE"]),
            xytext=(row["RMSE"] + dx, row["MAE"] + dy),
            fontsize=5.4,
            arrowprops={"arrowstyle": "-", "lw": 0.45, "color": "#606060"},
        )
    ax.text(
        0.98,
        0.96,
        "lower is better",
        transform=ax.transAxes,
        ha="right",
        va="top",
        fontsize=5.3,
        color="#606060",
    )
    panel_label(ax, "b")


def best_by_group(df: pd.DataFrame) -> pd.DataFrame:
    order = [
        "proposed_model_reference",
        "evolutionary_optimized_ml",
        "conventional_ml",
        "linear_baseline",
    ]
    rows = []
    for group in order:
        group_df = df.loc[df["BenchmarkGroup"] == group].sort_values(["R2", "RMSE"], ascending=[False, True])
        if not group_df.empty:
            rows.append(group_df.iloc[0])
    return pd.DataFrame(rows)


def draw_family_best(ax, df: pd.DataFrame) -> None:
    best = best_by_group(df).iloc[::-1].reset_index(drop=True)
    y = np.arange(len(best))
    height = 0.32
    ax.barh(
        y + height / 2,
        best["RMSE"],
        height=height,
        color="#8FB8D8",
        edgecolor="none",
        label="RMSE",
    )
    ax.barh(
        y - height / 2,
        best["MAE"],
        height=height,
        color="#D6A6B5",
        edgecolor="none",
        label="MAE",
    )
    labels = [f"{row.ModelShort}\nR2={row.R2:.3f}" for row in best.itertuples()]
    ax.set_yticks(y)
    ax.set_yticklabels(labels, fontsize=5.4)
    ax.set_xlabel("Error (C)")
    ax.set_title("Best model within each family", loc="left", fontsize=7.5, fontweight="bold")
    ax.grid(axis="x", color="#E8E8E8", lw=0.5)
    ax.set_axisbelow(True)
    ax.legend(loc="lower right", frameon=False, fontsize=5.5, handlelength=1.4)
    for i, row in best.iterrows():
        ax.text(row["RMSE"] + 0.012, i + height / 2, f"{row['RMSE']:.3f}", va="center", fontsize=5.0)
        ax.text(row["MAE"] + 0.012, i - height / 2, f"{row['MAE']:.3f}", va="center", fontsize=5.0)
    ax.set_xlim(0, max(float(best["RMSE"].max()) + 0.08, 0.55))
    panel_label(ax, "c")


def add_legend(fig) -> None:
    handles = [
        Line2D(
            [0],
            [0],
            marker=GROUP_MARKERS[group],
            color="none",
            markerfacecolor=GROUP_COLORS[group],
            markeredgecolor="white",
            markeredgewidth=0.5,
            markersize=7 if group == "proposed_model_reference" else 5,
            label=GROUP_LABELS[group],
        )
        for group in [
            "proposed_model_reference",
            "evolutionary_optimized_ml",
            "conventional_ml",
            "linear_baseline",
        ]
    ]
    fig.legend(
        handles=handles,
        loc="upper center",
        ncol=4,
        frameon=False,
        bbox_to_anchor=(0.52, 0.995),
        fontsize=6.0,
        handletextpad=0.35,
        columnspacing=1.1,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Plot the reproduced 33-model benchmark.")
    parser.add_argument("--benchmark-output-dir", type=Path, default=DEFAULT_BENCHMARK_OUTPUT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    benchmark_output = args.benchmark_output_dir.resolve()
    table_path = benchmark_output / "表格" / "14_full_model_benchmark_summary.csv"
    out_dir = benchmark_output / "图件"
    out_dir.mkdir(parents=True, exist_ok=True)
    df_full = load_summary(table_path)
    df = df_full.loc[~df_full["Model"].isin(EXCLUDED_FROM_MAIN_FIGURE)].copy()

    fig = plt.figure(figsize=(7.2, 7.4), constrained_layout=False)
    gs = fig.add_gridspec(
        2,
        2,
        width_ratios=[1.18, 1.0],
        height_ratios=[1.0, 0.82],
        left=0.16,
        right=0.985,
        top=0.92,
        bottom=0.075,
        wspace=0.34,
        hspace=0.42,
    )
    ax_a = fig.add_subplot(gs[:, 0])
    ax_b = fig.add_subplot(gs[0, 1])
    ax_c = fig.add_subplot(gs[1, 1])

    draw_r2_ranking(ax_a, df)
    draw_pareto(ax_b, df)
    draw_family_best(ax_c, df)
    add_legend(fig)

    base = out_dir / "fig_14_full_model_benchmark_maintext"
    fig.savefig(base.with_suffix(".svg"), bbox_inches="tight")
    fig.savefig(base.with_suffix(".pdf"), bbox_inches="tight")
    fig.savefig(base.with_suffix(".png"), dpi=300, bbox_inches="tight")
    fig.savefig(base.with_suffix(".tiff"), dpi=600, bbox_inches="tight")
    plt.close(fig)
    print(base.with_suffix(".png"))
    print(base.with_suffix(".svg"))
    print(base.with_suffix(".pdf"))
    print(base.with_suffix(".tiff"))


if __name__ == "__main__":
    main()
