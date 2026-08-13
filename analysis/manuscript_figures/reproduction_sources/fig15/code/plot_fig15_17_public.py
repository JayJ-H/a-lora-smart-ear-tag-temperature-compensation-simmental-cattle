#!/usr/bin/env python3
"""Rebuild manuscript Figs. 15-17 from the strict TH-SHRC tables.

The public GitHub entry point and table contract are retained.  The panel
composition follows the final manuscript artwork rather than the simplified
public analytical redraw preserved under ``upstream/``.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import Patch
import numpy as np
import pandas as pd


SCRIPT = Path(__file__).resolve()
if SCRIPT.parent.name == "code" and SCRIPT.parent.parent.name == "fig15":
    FIGURE_ROOT = SCRIPT.parent.parent
    DATA = FIGURE_ROOT / ("数据" if (FIGURE_ROOT / "data").is_dir() else "data")
    OUTPUT = FIGURE_ROOT / ("输出" if DATA.name == "数据" else "outputs")
else:
    ROOT = SCRIPT.parents[2]
    DATA = ROOT / "data" / "处理数据"
    OUTPUT = ROOT / "outputs" / "论文图件" / "Fig15_17"
ORDER = ["Full A+B+C", "w/o C (A+B)", "w/o B (A+C)", "w/o A (B+C)"]
SHORT = {
    "Full A+B+C": "Full A+B+C",
    "w/o C (A+B)": "A+B",
    "w/o B (A+C)": "A+C",
    "w/o A (B+C)": "B+C",
}
COLORS = {
    "Full A+B+C": "#B6202E",
    "w/o C (A+B)": "#CA5A76",
    "w/o B (A+C)": "#45A9BF",
    "w/o A (B+C)": "#28449A",
}
COMPONENTS = {
    "Full A+B+C": (1, 1, 1),
    "w/o C (A+B)": (1, 1, 0),
    "w/o B (A+C)": (1, 0, 1),
    "w/o A (B+C)": (0, 1, 1),
}
PREDICTION_COLUMNS = {
    "Full A+B+C": "Predicted_Full_ABC_C",
    "w/o C (A+B)": "Predicted_Without_C_AB_C",
    "w/o B (A+C)": "Predicted_Without_B_AC_C",
    "w/o A (B+C)": "Predicted_Without_A_BC_C",
}
PUBLICATION_LAYOUT = False
COMPACT_ARTWORK = False


def mm_size(width_mm: float, height_mm: float) -> tuple[float, float]:
    return width_mm / 25.4, height_mm / 25.4


def configure_style() -> None:
    plt.rcParams.update(
        {
            "font.family": "serif",
            "font.serif": ["Times New Roman", "Liberation Serif", "DejaVu Serif"],
            "font.size": 10,
            "axes.titlesize": 12,
            "axes.labelsize": 11,
            "xtick.labelsize": 9,
            "ytick.labelsize": 9,
            "axes.linewidth": 0.9,
            "svg.fonttype": "none",
            "pdf.fonttype": 42,
            "ps.fonttype": 42,
        }
    )
    if COMPACT_ARTWORK:
        plt.rcParams.update(
            {
                "font.size": 7,
                "axes.titlesize": 7.5,
                "axes.labelsize": 7.5,
                "xtick.labelsize": 7,
                "ytick.labelsize": 7,
                "legend.fontsize": 7,
                "axes.linewidth": 0.7,
            }
        )


def save_all(fig: plt.Figure, output: Path, stem: str) -> None:
    output.mkdir(parents=True, exist_ok=True)
    bbox = None if PUBLICATION_LAYOUT else "tight"
    fig.savefig(output / f"{stem}.png", dpi=600, bbox_inches=bbox, facecolor="white")
    fig.savefig(
        output / f"{stem}.tiff",
        dpi=600,
        bbox_inches=bbox,
        facecolor="white",
        pil_kwargs={"compression": "tiff_lzw"},
    )
    fig.savefig(output / f"{stem}.svg", bbox_inches=bbox, facecolor="white")
    fig.savefig(output / f"{stem}.pdf", bbox_inches=bbox, facecolor="white")
    plt.close(fig)


def clean_axes(ax: plt.Axes, grid_axis: str | None = None) -> None:
    ax.spines[["top", "right"]].set_visible(False)
    if grid_axis:
        ax.grid(axis=grid_axis, color="#C7CDD2", linewidth=0.55, alpha=0.45, linestyle="--")


def ordered_metrics(metrics: pd.DataFrame) -> pd.DataFrame:
    actual = set(metrics["Configuration"])
    if actual != set(ORDER):
        raise RuntimeError(f"Unexpected ablation configurations: {sorted(actual)}")
    result = metrics.set_index("Configuration").loc[ORDER].copy()
    if not (result["N"].astype(int) == 520).all():
        raise RuntimeError("Expected 520 rows in every ablation configuration")
    return result


def component_panel(metrics: pd.DataFrame, output: Path) -> None:
    fig = plt.figure(figsize=mm_size(190, 121.4) if PUBLICATION_LAYOUT else (13.2, 6.9))
    if COMPACT_ARTWORK:
        grid = fig.add_gridspec(2, 3, height_ratios=[3.5, 1.25], hspace=0.14, wspace=0.25)
        first_plot_column = 0
    else:
        grid = fig.add_gridspec(
            2,
            4,
            width_ratios=[1.45, 1.0, 1.0, 1.0] if PUBLICATION_LAYOUT else [0.82, 1.0, 1.0, 1.0],
            height_ratios=[3.4, 1.45],
            hspace=0.16,
            wspace=0.36 if PUBLICATION_LAYOUT else 0.28,
        )
        first_plot_column = 1
        ax_text = fig.add_subplot(grid[:, 0])
        ax_text.axis("off")
        ax_text.text(0.0, 0.96, "Strict component\nablation", fontsize=11 if PUBLICATION_LAYOUT else 15, fontweight="bold", va="top")
        ax_text.text(
            0.0,
            0.78,
            "A  Thermal-state memory\n"
            "B  Individual-session\n   calibration\n"
            "C  Hierarchical residual\n   correction",
            fontsize=8.5 if PUBLICATION_LAYOUT else 10.5,
            va="top",
            linespacing=1.35,
        )
        ax_text.text(0.0, 0.47, "The complete model is shown\nwith a hatched outline.", fontsize=8 if PUBLICATION_LAYOUT else 9.2, va="top")

    plot_specs = [("R2", "R²", "Higher is better"), ("RMSE_C", "RMSE (°C)", "Lower is better"), ("MAE_C", "MAE (°C)", "Lower is better")]
    x = np.arange(len(ORDER))
    for index, (column, ylabel, cue) in enumerate(plot_specs, start=first_plot_column):
        ax = fig.add_subplot(grid[0, index])
        values = metrics[column].to_numpy(float)
        bars = ax.bar(
            x,
            values,
            width=0.68,
            color=["white", COLORS[ORDER[1]], COLORS[ORDER[2]], COLORS[ORDER[3]]],
            edgecolor=["black", "#5B2833", "#225A67", "#172B67"],
            linewidth=[1.2, 0.7, 0.7, 0.7] if COMPACT_ARTWORK else [1.8, 0.9, 0.9, 0.9],
            hatch=["//", None, None, None],
        )
        span = max(values) - min(values)
        padding = max(span * 0.22, 0.018)
        lower = max(0.0, min(values) - padding)
        upper = max(values) + padding * 1.35
        ax.set_ylim(lower, upper)
        for bar, value in zip(bars, values):
            ax.text(bar.get_x() + bar.get_width() / 2, value + padding * 0.12, f"{value:.3f}", ha="center", va="bottom", fontsize=7 if COMPACT_ARTWORK else 8.5)
        ax.set_ylabel(ylabel)
        ax.set_xticks([])
        if not COMPACT_ARTWORK:
            ax.set_title(cue, fontsize=9.5, pad=8)
        clean_axes(ax, "y")

    ax_matrix = fig.add_subplot(grid[1, :] if COMPACT_ARTWORK else grid[1, 1:])
    ax_matrix.set_xlim(-0.45, len(ORDER) - 0.55)
    ax_matrix.set_ylim(-0.7, 2.7)
    for col, configuration in enumerate(ORDER):
        active = COMPONENTS[configuration]
        active_rows = [row for row, flag in enumerate(active) if flag]
        if len(active_rows) > 1:
            ax_matrix.plot([col, col], [min(active_rows), max(active_rows)], color=COLORS[configuration], linewidth=1.5 if COMPACT_ARTWORK else 3.0, zorder=1)
        for row, flag in enumerate(active):
            ax_matrix.scatter(
                col,
                row,
                s=52 if COMPACT_ARTWORK else 115,
                facecolor=COLORS[configuration] if flag else "white",
                edgecolor="black",
                linewidth=0.7 if COMPACT_ARTWORK else 1.1,
                zorder=2,
            )
    ax_matrix.set_yticks([0, 1, 2], ["A", "B", "C"])
    ax_matrix.set_xticks(x, [SHORT[item] for item in ORDER])
    ax_matrix.invert_yaxis()
    ax_matrix.set_xlabel("Components" if COMPACT_ARTWORK else "Component combination")
    ax_matrix.tick_params(length=0)
    for spine in ax_matrix.spines.values():
        spine.set_visible(False)

    if not COMPACT_ARTWORK:
        fig.suptitle("TH-SHRC component-combination ablation", y=0.995, fontsize=14)
    if COMPACT_ARTWORK:
        fig.subplots_adjust(left=0.055, right=0.99, bottom=0.08, top=0.975)
    elif PUBLICATION_LAYOUT:
        fig.subplots_adjust(left=0.04, right=0.985, bottom=0.09, top=0.90)
    save_all(fig, output, "Fig15a_component_combination_ablation")


def nested_panel(metrics: pd.DataFrame, bootstrap: pd.DataFrame, output: Path) -> None:
    fig, (ax, inset) = plt.subplots(
        1,
        2,
        figsize=mm_size(190, 88.6) if PUBLICATION_LAYOUT else (12.2, 5.3),
        gridspec_kw={"width_ratios": [4.8, 1.25], "wspace": 0.16},
    )
    y = np.arange(len(ORDER))
    coverage = metrics["Within_0_5C"].to_numpy(float)
    r2 = metrics["R2"].to_numpy(float)
    colors = [COLORS[item] for item in ORDER]

    ax.barh(y, coverage, height=0.68, color=colors, alpha=0.18, edgecolor="none", zorder=1)
    ax.barh(y, r2, height=0.38, color=colors, alpha=1.0, edgecolor="none", zorder=2)
    for row, (r2_value, coverage_value, color) in enumerate(zip(r2, coverage, colors)):
        if r2_value > 0.30:
            label_x, label_align = r2_value - 0.015, "right"
            text_color = "white" if r2_value > 0.67 else "black"
        else:
            label_x, label_align, text_color = r2_value + 0.012, "left", "black"
        ax.text(label_x, row, f"R² {r2_value:.3f}", ha=label_align, va="center", color=text_color, fontsize=7 if COMPACT_ARTWORK else 9, fontweight="bold")
        ax.text(coverage_value + 0.01, row, f"{coverage_value * 100:.1f}%" if COMPACT_ARTWORK else f"≤0.5°C {coverage_value * 100:.1f}%", ha="left", va="center", color=color, fontsize=7 if COMPACT_ARTWORK else 9)
    ax.set_yticks(y, [SHORT[item] for item in ORDER])
    ax.invert_yaxis()
    ax.set_xlim(0.0, 1.08)
    x_left, x_right = ax.get_xlim()
    if x_left > min(r2.min(), coverage.min()) or x_right < max(r2.max(), coverage.max()):
        raise RuntimeError("Fig. 15b performance bars would be clipped by the x-axis limits")
    ax.set_xlabel("Score / coverage" if COMPACT_ARTWORK else "Performance scale")
    if not COMPACT_ARTWORK:
        ax.set_title("Layered performance view: explained variance and error coverage", pad=9)
    clean_axes(ax, "x")

    delta_lookup = bootstrap.set_index("RemovedModel")
    delta = np.array([0.0, delta_lookup.loc["C", "Delta_RMSE_C"], delta_lookup.loc["B", "Delta_RMSE_C"], delta_lookup.loc["A", "Delta_RMSE_C"]], dtype=float)
    inset.barh(y, delta, height=0.64, color=colors, alpha=0.78)
    inset_limit = max(float(delta.max()) * 1.16, 0.12)
    inset.set_xlim(0.0, inset_limit)
    for row, value in enumerate(delta):
        if value > inset_limit * 0.30:
            label_x, label_align, label_color = value - inset_limit * 0.025, "right", "white"
        else:
            label_x, label_align, label_color = value + inset_limit * 0.025, "left", "black"
        inset.text(label_x, row, f"{value:.3f}", ha=label_align, va="center", color=label_color, fontsize=7 if COMPACT_ARTWORK else 8, clip_on=False)
    inset.set_yticks([])
    inset.invert_yaxis()
    inset.set_xlabel("ΔRMSE (°C)", fontsize=7.5 if COMPACT_ARTWORK else 8, labelpad=1)
    if not COMPACT_ARTWORK:
        inset.set_title("Error penalty", fontsize=9, pad=3)
    inset.tick_params(axis="x", labelsize=7 if COMPACT_ARTWORK else 8)
    clean_axes(inset, "x")

    ax.legend(
        handles=[Patch(facecolor="#777777", alpha=1.0, label="R²"), Patch(facecolor="#777777", alpha=0.18, label="Within ±0.5 °C")],
        loc="upper left",
        bbox_to_anchor=(0.0, 1.02),
        frameon=False,
        ncol=2,
        fontsize=7 if COMPACT_ARTWORK else 8.5,
    )
    if COMPACT_ARTWORK:
        fig.subplots_adjust(left=0.11, right=0.985, bottom=0.18, top=0.95)
    save_all(fig, output, "Fig15b_nested_performance")


def combine_fig15(output: Path) -> None:
    from PIL import Image, ImageDraw, ImageFont

    top = Image.open(output / "Fig15a_component_combination_ablation.png").convert("RGB")
    bottom = Image.open(output / "Fig15b_nested_performance.png").convert("RGB")
    target_width = max(top.width, bottom.width)

    def resize_width(image: Image.Image) -> Image.Image:
        if image.width == target_width:
            return image
        return image.resize((target_width, round(image.height * target_width / image.width)), Image.Resampling.LANCZOS)

    top = resize_width(top)
    bottom = resize_width(bottom)
    margin, gap = 70, 65
    canvas = Image.new("RGB", (target_width + 2 * margin, top.height + bottom.height + gap + 2 * margin), "white")
    canvas.paste(top, (margin, margin))
    canvas.paste(bottom, (margin, margin + top.height + gap))
    draw = ImageDraw.Draw(canvas)
    font_path = Path(r"C:\Windows\Fonts\timesbd.ttf")
    font = ImageFont.truetype(str(font_path), 80) if font_path.is_file() else ImageFont.load_default()
    draw.text((20, 18), "a", fill="black", font=font)
    draw.text((20, margin + top.height + gap - 5), "b", fill="black", font=font)
    canvas.save(output / "Fig15_TH_SHRC_ablation.png", dpi=(600, 600))
    canvas.save(output / "Fig15_TH_SHRC_ablation.tiff", dpi=(600, 600), compression="tiff_lzw")
    canvas.save(output / "Fig15_TH_SHRC_ablation.pdf", resolution=600)


def select_representative(rows: pd.DataFrame, metrics: pd.DataFrame) -> tuple[str, pd.DataFrame]:
    work = rows.copy()
    work["AbsoluteErrorFull_C"] = (work["Actual_C"] - work["Predicted_Full_ABC_C"]).abs()
    per_cow = work.groupby("CowKey").agg(
        N=("RowID", "size"),
        FullMAE_C=("AbsoluteErrorFull_C", "mean"),
        ActualRange_C=("Actual_C", lambda values: float(values.max() - values.min())),
    )
    eligible = per_cow[per_cow["ActualRange_C"] >= 1.0].copy()
    if eligible.empty:
        eligible = per_cow.copy()
    target = float(metrics.loc["Full A+B+C", "MAE_C"])
    eligible["DistanceToOverallMAE_C"] = (eligible["FullMAE_C"] - target).abs()
    selected = str(eligible.sort_values(["DistanceToOverallMAE_C", "ActualRange_C"], ascending=[True, False]).index[0])
    check = per_cow.reset_index()
    check["Selected"] = check["CowKey"].astype(str).eq(selected)
    check["SelectionRule"] = "Actual range >= 1.0 C; minimum absolute distance from overall full-model MAE"
    return selected, check


def trajectory_panel(rows: pd.DataFrame, metrics: pd.DataFrame, output: Path) -> None:
    selected, check = select_representative(rows, metrics)
    check.to_csv(output / "Fig16_representative_case_selection.csv", index=False, lineterminator="\n")
    part = rows[rows["CowKey"].astype(str) == selected].sort_values("RowID").copy()
    part["Observation"] = np.arange(1, len(part) + 1)
    full_mae = float(np.mean(np.abs(part["Actual_C"] - part["Predicted_Full_ABC_C"])))

    fig, ax = plt.subplots(figsize=mm_size(190, 71.9) if PUBLICATION_LAYOUT else (12.4, 4.0))
    ax.plot(part["Observation"], part["Actual_C"], marker="o", markersize=2.0 if COMPACT_ARTWORK else 3.4, linewidth=1.2 if COMPACT_ARTWORK else 2.25, color="#2878A5", label="Measured" if COMPACT_ARTWORK else "Measured core temperature")
    for configuration, label in [("Full A+B+C", "Full A+B+C"), ("w/o C (A+B)", "A+B"), ("w/o B (A+C)", "A+C"), ("w/o A (B+C)", "B+C")]:
        ax.plot(part["Observation"], part[PREDICTION_COLUMNS[configuration]], linewidth=(1.1 if configuration == "Full A+B+C" else 0.8) if COMPACT_ARTWORK else (1.7 if configuration == "Full A+B+C" else 1.25), color=COLORS[configuration], label=label)
    ax.set_xlabel("Observation" if COMPACT_ARTWORK else "Within-cattle observation order")
    ax.set_ylabel("Core T (°C)" if COMPACT_ARTWORK else "Core temperature (°C)")
    if not COMPACT_ARTWORK:
        ax.set_title(f"Representative cattle {selected} (full-model MAE = {full_mae:.3f} °C)")
    ax.set_xticks(np.arange(1, len(part) + 1))
    ax.grid(color="#C7CDD2", linewidth=0.55, alpha=0.45)
    clean_axes(ax)
    ax.legend(frameon=False, ncol=5, loc="lower right", bbox_to_anchor=(1.0, 1.01), borderaxespad=0, fontsize=7 if COMPACT_ARTWORK else 8.5, handlelength=1.5)
    if COMPACT_ARTWORK:
        fig.subplots_adjust(left=0.075, right=0.99, bottom=0.17, top=0.89)
    elif PUBLICATION_LAYOUT:
        fig.subplots_adjust(left=0.10, right=0.985, bottom=0.20, top=0.83)
    save_all(fig, output, "Fig16_representative_OOF_trajectory")


def radar_panel(metrics: pd.DataFrame, output: Path) -> None:
    full = metrics.loc["Full A+B+C"]
    normalized = pd.DataFrame(index=metrics.index)
    normalized["R²"] = metrics["R2"] / full["R2"]
    normalized["RMSE"] = full["RMSE_C"] / metrics["RMSE_C"]
    normalized["MAE"] = full["MAE_C"] / metrics["MAE_C"]
    normalized["P95 error"] = full["P95_AE_C"] / metrics["P95_AE_C"]
    normalized["≤0.5°C"] = metrics["Within_0_5C"] / full["Within_0_5C"]
    normalized = normalized.clip(lower=0.0, upper=1.0)
    normalized.to_csv(output / "Fig17_relative_performance_values.csv", index_label="Configuration", lineterminator="\n")

    labels = list(normalized.columns)
    angles = np.linspace(0, 2 * np.pi, len(labels), endpoint=False)
    closed_angles = np.r_[angles, angles[0]]
    fig, ax = plt.subplots(figsize=mm_size(90, 100) if PUBLICATION_LAYOUT else (7.8, 8.4), subplot_kw={"projection": "polar"})
    for configuration in reversed(ORDER):
        values = normalized.loc[configuration].to_numpy(float)
        ax.plot(closed_angles, np.r_[values, values[0]], color=COLORS[configuration], linewidth=1.1 if COMPACT_ARTWORK else 2.0, marker="o", markersize=3.0 if COMPACT_ARTWORK else 5.5, markerfacecolor="white", markeredgewidth=0.8 if COMPACT_ARTWORK else 1.5, label=SHORT[configuration])
    ax.set_xticks(angles)
    ax.set_xticklabels([])
    ax.set_ylim(0.0, 1.05)
    radial_ticks = [0.4, 0.6, 0.8, 1.0]
    ax.set_yticks(radial_ticks)
    ax.set_yticklabels([])
    ax.set_axisbelow(True)
    ax.grid(color="#BFC6CC", linewidth=0.5 if COMPACT_ARTWORK else 0.7, alpha=0.75, linestyle="--")
    label_radius = 1.13
    for index, (angle, label) in enumerate(zip(angles, labels)):
        cosine = np.cos(angle)
        sine = np.sin(angle)
        horizontal = "center" if abs(cosine) < 0.25 else ("left" if cosine > 0 else "right")
        vertical = "center" if abs(sine) < 0.25 else ("bottom" if sine > 0 else "top")
        text = ax.text(
            angle,
            label_radius,
            label,
            ha=horizontal,
            va=vertical,
            fontsize=7.2 if COMPACT_ARTWORK else 9,
            zorder=100,
            clip_on=False,
        )
        text.set_gid(f"top_text_category_{index + 1}")
    radial_angle = np.deg2rad(20.0)
    for index, radius in enumerate(radial_ticks):
        text = ax.text(
            radial_angle,
            radius,
            f"{radius:.1f}",
            ha="left",
            va="center",
            fontsize=7 if COMPACT_ARTWORK else 8.5,
            zorder=100,
            bbox=dict(facecolor="white", edgecolor="none", alpha=0.90, pad=0.08),
        )
        text.set_gid(f"top_text_radial_{index + 1}")
    if not COMPACT_ARTWORK:
        ax.set_title("Relative performance profiles of the complete and ablated models", pad=24, fontsize=14)
        fig.text(0.5, 0.025, "All axes are oriented so that larger values indicate better performance; error scores are inverse ratios relative to the complete model.", ha="center", fontsize=8.5)
    fig.subplots_adjust(top=0.90 if COMPACT_ARTWORK else 0.88, bottom=0.20 if COMPACT_ARTWORK else 0.23, left=0.12 if COMPACT_ARTWORK else 0.08, right=0.88 if COMPACT_ARTWORK else 0.92)
    legend = ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.13 if COMPACT_ARTWORK else -0.15), frameon=False, ncol=2, handlelength=1.3, columnspacing=0.9)
    for text in ax.texts:
        text.set_zorder(20)
    legend.set_zorder(30)
    legend.set_gid("top_text_legend")
    save_all(fig, output, "Fig17_relative_performance_radar")


def build_check(metrics: pd.DataFrame, rows: pd.DataFrame, output: Path) -> None:
    records = []
    expected = {
        "Fig15a_component_combination_ablation": 4,
        "Fig15b_nested_performance": 4,
        "Fig16_representative_OOF_trajectory": 1,
        "Fig17_relative_performance_radar": 5,
    }
    for stem, panel_measure in expected.items():
        for suffix in ("png", "svg", "pdf", "tiff"):
            path = output / f"{stem}.{suffix}"
            records.append({"Figure": stem, "Format": suffix, "Exists": path.is_file(), "Bytes": path.stat().st_size if path.is_file() else 0, "ExpectedContentCount": panel_measure})
    check = pd.DataFrame(records)
    check.to_csv(output / "Fig15_17_export_check.csv", index=False, lineterminator="\n")
    if not check["Exists"].all() or (check["Bytes"] <= 0).any():
        raise RuntimeError("One or more Fig. 15-17 exports are missing")
    if len(rows) != 520 or rows["RowID"].nunique() != 520:
        raise RuntimeError("Expected 520 unique OOF rows")
    if metrics.index.tolist() != ORDER:
        raise RuntimeError("Ablation ordering changed unexpectedly")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=DATA)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT)
    parser.add_argument("--publication-layout", action="store_true", help="Export at final 190 mm-wide manuscript panel sizes.")
    parser.add_argument("--compact-artwork", action="store_true", help="Remove titles and use compact 7 pt publication styling.")
    return parser.parse_args()


def main() -> int:
    global PUBLICATION_LAYOUT, COMPACT_ARTWORK
    args = parse_args()
    PUBLICATION_LAYOUT = args.publication_layout
    COMPACT_ARTWORK = args.compact_artwork
    data = args.data_dir.resolve()
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    configure_style()
    metrics = ordered_metrics(pd.read_csv(data / "th_shrc_ablation_metrics.csv"))
    bootstrap = pd.read_csv(data / "th_shrc_ablation_bootstrap.csv")
    rows = pd.read_csv(data / "th_shrc_ablation_oof_predictions.csv")
    component_panel(metrics, output)
    nested_panel(metrics, bootstrap, output)
    combine_fig15(output)
    trajectory_panel(rows, metrics, output)
    radar_panel(metrics, output)
    build_check(metrics, rows, output)
    print(f"MANUSCRIPT_FIG15_17_STATUS=PASS\nOUTPUT={output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
