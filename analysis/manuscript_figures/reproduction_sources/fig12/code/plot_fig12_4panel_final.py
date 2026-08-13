from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from PIL import Image
from scipy.stats import gaussian_kde, linregress, pearsonr
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from statsmodels.nonparametric.smoothers_lowess import lowess

# ---------------------------------------------------------------------
# Input and output paths. The statistical and plotting logic follows the
# published Chinese GitHub reproduction script; export layout is standardized.
# ---------------------------------------------------------------------
script_dir = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(
    description="Regenerate the four-panel TH-SHRC performance figure."
)
parser.add_argument(
    "--input-csv",
    type=Path,
    default=script_dir.parent / "data" / "Fig12_input_520_records.csv",
)
parser.add_argument(
    "--output-dir",
    type=Path,
    default=script_dir.parent / "outputs",
)
parser.add_argument("--expected-rows", type=int, default=520)
parser.add_argument(
    "--publication-layout",
    action="store_true",
    help="Export each panel at 95 x 80 mm for a 190 mm-wide 2x2 layout.",
)
parser.add_argument(
    "--compact-artwork",
    action="store_true",
    help="Remove panel titles, shorten labels, and use 7 pt final-size lettering.",
)
args = parser.parse_args()

output_dir = args.output_dir.resolve()
output_dir.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------
# Load the final paired-record dataset
# ---------------------------------------------------------------------
df = pd.read_csv(args.input_csv.resolve())

data = (
    df[["Ear", "Air", "Actual", "Predicted"]]
    .apply(pd.to_numeric, errors="coerce")
    .dropna()
    .rename(
        columns={
            "Ear": "Ear_surface_temperature_C",
            "Air": "Local_ambient_temperature_C",
            "Actual": "Measured_core_temperature_C",
            "Predicted": "Predicted_core_temperature_C",
        }
    )
)

if len(data) != args.expected_rows:
    raise ValueError(
        f"Expected {args.expected_rows} complete paired records, found {len(data)}"
    )

ear = data["Ear_surface_temperature_C"].to_numpy()
core = data["Measured_core_temperature_C"].to_numpy()
pred = data["Predicted_core_temperature_C"].to_numpy()

raw_error = core - ear
residual = core - pred  # Positive = model underestimation
raw_abs = np.abs(raw_error)
pred_abs = np.abs(residual)

# ---------------------------------------------------------------------
# Statistics
# ---------------------------------------------------------------------
def concordance_correlation_coefficient(x: np.ndarray, y: np.ndarray) -> float:
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    cov_xy = np.cov(x, y, ddof=1)[0, 1]
    var_x = np.var(x, ddof=1)
    var_y = np.var(y, ddof=1)
    return float(
        2 * cov_xy
        / (var_x + var_y + (np.mean(x) - np.mean(y)) ** 2)
    )

raw_metrics = {
    "Pearson_r": pearsonr(core, ear).statistic,
    "RMSE_C": np.sqrt(mean_squared_error(core, ear)),
    "MAE_C": mean_absolute_error(core, ear),
    "CCC": concordance_correlation_coefficient(core, ear),
}

model_metrics = {
    "R2": r2_score(core, pred),
    "Pearson_r": pearsonr(core, pred).statistic,
    "RMSE_C": np.sqrt(mean_squared_error(core, pred)),
    "MAE_C": mean_absolute_error(core, pred),
    "CCC": concordance_correlation_coefficient(core, pred),
}

bias = float(np.mean(residual))
sd_diff = float(np.std(residual, ddof=1))
loa_low = bias - 1.96 * sd_diff
loa_high = bias + 1.96 * sd_diff

thresholds = [0.2, 0.3, 0.5, 1.0]
threshold_stats = {
    t: {
        "raw_pct": float(np.mean(raw_abs <= t) * 100),
        "compensated_pct": float(np.mean(pred_abs <= t) * 100),
    }
    for t in thresholds
}

# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------
plt.rcParams.update(
    {
        "font.family": "serif",
        "font.serif": ["Times New Roman", "Liberation Serif", "DejaVu Serif"],
        "font.size": 10,
        "axes.labelsize": 11,
        "axes.titlesize": 11,
        "xtick.labelsize": 9,
        "ytick.labelsize": 9,
        "axes.linewidth": 0.9,
        "legend.fontsize": 8.5,
        "pdf.fonttype": 42,
        "ps.fonttype": 42,
        "svg.fonttype": "none",
    }
)

if args.compact_artwork:
    plt.rcParams.update(
        {
            "font.size": 7,
            "axes.labelsize": 7.5,
            "axes.titlesize": 7.5,
            "xtick.labelsize": 7,
            "ytick.labelsize": 7,
            "legend.fontsize": 7,
            "axes.linewidth": 0.7,
        }
    )

panel_width_mm = 95.0 if args.publication_layout else 203.2
panel_height_mm = 80.0 if args.publication_layout else 169.333
panel_size = (panel_width_mm / 25.4, panel_height_mm / 25.4)
panel_dpi = 600 if args.publication_layout else 300
panel_pixel_size = tuple(round(value * panel_dpi) for value in panel_size)
panel_margins = {
    "left": 0.15 if args.compact_artwork else (0.17 if args.publication_layout else 0.145),
    "right": 0.98 if args.compact_artwork else (0.97 if args.publication_layout else 0.965),
    "bottom": 0.16 if args.compact_artwork else (0.18 if args.publication_layout else 0.145),
    "top": 0.975 if args.compact_artwork else (0.93 if args.publication_layout else 0.955),
}

def local_density(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    xy = np.vstack(
        [
            (x - np.mean(x)) / np.std(x, ddof=1),
            (y - np.mean(y)) / np.std(y, ddof=1),
        ]
    )
    density = gaussian_kde(xy)(xy)
    return density

def panel_label(ax, text: str) -> None:
    ax.text(
        0.02,
        0.98,
        text,
        transform=ax.transAxes,
        ha="left",
        va="top",
        fontsize=10,
        fontweight="bold",
    )

def clean_axes(ax) -> None:
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(alpha=0.18, linewidth=0.6)


def save_panel(fig, png_path: Path, svg_path: Path) -> None:
    fig.subplots_adjust(**panel_margins)
    fig.savefig(png_path, dpi=panel_dpi, facecolor="white")
    fig.savefig(svg_path, facecolor="white")
    fig.savefig(svg_path.with_suffix(".pdf"), facecolor="white")
    fig.savefig(
        svg_path.with_suffix(".tiff"),
        dpi=panel_dpi,
        facecolor="white",
        pil_kwargs={"compression": "tiff_lzw"},
    )

# ---------------------------------------------------------------------
# Panel (a): Before compensation
# ---------------------------------------------------------------------
density_a = local_density(core, ear)
order_a = np.argsort(density_a)

fig_a, ax_a = plt.subplots(figsize=panel_size)
ax_a.scatter(
    core[order_a],
    ear[order_a],
    c=density_a[order_a],
    s=9 if args.compact_artwork else 28,
    alpha=0.68 if args.compact_artwork else 0.82,
    linewidths=0.1,
)
ax_a.plot([37.3, 41.7], [37.3, 41.7], linestyle="--", linewidth=0.8 if args.compact_artwork else 1.4, label="Identity")

smooth_a = lowess(ear, core, frac=0.36, return_sorted=True)
ax_a.plot(
    smooth_a[:, 0],
    smooth_a[:, 1],
    linewidth=1.1 if args.compact_artwork else 2.0,
    label="Lowess",
)

ax_a.set_xlim(37.3, 41.7)
ax_a.set_ylim(24.5, 40.5)
ax_a.set_xlabel("Measured core T (°C)" if args.compact_artwork else "Measured core temperature (°C)")
ax_a.set_ylabel("Ear-surface T (°C)" if args.compact_artwork else "Raw ear-surface temperature (°C)")
if not args.compact_artwork:
    panel_label(ax_a, "(a) Before compensation")
ax_a.text(
    0.97,
    0.05,
    (
        f"r = {raw_metrics['Pearson_r']:.3f}\n"
        f"RMSE = {raw_metrics['RMSE_C']:.3f}\n"
        f"MAE = {raw_metrics['MAE_C']:.3f}"
    ),
    transform=ax_a.transAxes,
    ha="right",
    va="bottom",
    fontsize=7 if args.compact_artwork else 8.5,
    bbox=dict(boxstyle="square,pad=0.22", facecolor="white", edgecolor="black", alpha=0.94, linewidth=0.5),
    zorder=8,
)
ax_a.legend(loc="upper right", frameon=False, handlelength=1.5)
clean_axes(ax_a)

panel_a_png = output_dir / "Fig12a_before_compensation.png"
panel_a_svg = output_dir / "Fig12a_before_compensation.svg"
save_panel(fig_a, panel_a_png, panel_a_svg)
plt.close(fig_a)

# ---------------------------------------------------------------------
# Panel (b): After compensation
# ---------------------------------------------------------------------
density_b = local_density(core, pred)
order_b = np.argsort(density_b)

fig_b, ax_b = plt.subplots(figsize=panel_size)
ax_b.scatter(
    core[order_b],
    pred[order_b],
    c=density_b[order_b],
    s=9 if args.compact_artwork else 28,
    alpha=0.68 if args.compact_artwork else 0.82,
    linewidths=0.1,
)

axis_min, axis_max = 37.3, 41.7
ax_b.plot(
    [axis_min, axis_max],
    [axis_min, axis_max],
    linestyle="--",
    linewidth=0.8 if args.compact_artwork else 1.4,
    label="Identity",
)

reg = linregress(core, pred)
x_grid = np.linspace(core.min(), core.max(), 250)
y_fit = reg.intercept + reg.slope * x_grid

n = len(core)
x_mean = np.mean(core)
sxx = np.sum((core - x_mean) ** 2)
fit_resid = pred - (reg.intercept + reg.slope * core)
s_err = np.sqrt(np.sum(fit_resid**2) / (n - 2))
ci = 1.96 * s_err * np.sqrt(1 / n + (x_grid - x_mean) ** 2 / sxx)

ax_b.plot(x_grid, y_fit, linewidth=1.1 if args.compact_artwork else 2.0, label="Fit")
ax_b.fill_between(x_grid, y_fit - ci, y_fit + ci, alpha=0.16, linewidth=0)

ax_b.set_xlim(axis_min, axis_max)
ax_b.set_ylim(axis_min, axis_max)
ax_b.set_xlabel("Measured core T (°C)" if args.compact_artwork else "Measured core temperature (°C)")
ax_b.set_ylabel("Predicted core T (°C)" if args.compact_artwork else "Predicted core temperature (°C)")
if not args.compact_artwork:
    panel_label(ax_b, "(b) After compensation")
ax_b.text(
    0.97,
    0.05,
    (
        f"R² = {model_metrics['R2']:.3f}\n"
        f"RMSE = {model_metrics['RMSE_C']:.3f}\n"
        f"MAE = {model_metrics['MAE_C']:.3f}"
    ),
    transform=ax_b.transAxes,
    ha="right",
    va="bottom",
    fontsize=7 if args.compact_artwork else 8.5,
    bbox=dict(boxstyle="square,pad=0.22", facecolor="white", edgecolor="black", alpha=0.94, linewidth=0.5),
    zorder=8,
)
ax_b.legend(loc="upper left", frameon=False)
clean_axes(ax_b)

panel_b_png = output_dir / "Fig12b_after_compensation.png"
panel_b_svg = output_dir / "Fig12b_after_compensation.svg"
save_panel(fig_b, panel_b_png, panel_b_svg)
plt.close(fig_b)

# ---------------------------------------------------------------------
# Panel (c): Enhanced Bland-Altman plot
# ---------------------------------------------------------------------
ba_mean = (core + pred) / 2
density_c = local_density(ba_mean, residual)
order_c = np.argsort(density_c)

fig_c, ax_c = plt.subplots(figsize=panel_size)
ax_c.scatter(
    ba_mean[order_c],
    residual[order_c],
    c=density_c[order_c],
    s=9 if args.compact_artwork else 28,
    alpha=0.68 if args.compact_artwork else 0.82,
    linewidths=0.1,
)

ax_c.axhline(bias, linewidth=1.0 if args.compact_artwork else 1.8, label=f"Bias {bias:.3f}")
ax_c.axhline(
    loa_low,
    linestyle="--",
    linewidth=0.8 if args.compact_artwork else 1.5,
    label=f"LoA {loa_low:.3f}",
)
ax_c.axhline(
    loa_high,
    linestyle="--",
    linewidth=0.8 if args.compact_artwork else 1.5,
    label=f"LoA {loa_high:.3f}",
)

# A visually useful ±0.5 °C band
ax_c.axhspan(-0.5, 0.5, alpha=0.07, linewidth=0)

ax_c.set_xlabel("Mean core T (°C)" if args.compact_artwork else "Mean of measured and predicted\ncore temperature (°C)")
ax_c.set_ylabel("Measured − predicted (°C)" if args.compact_artwork else "Difference: measured − predicted (°C)")
if args.compact_artwork:
    ax_c.text(
        0.58,
        0.95,
        f"Bias = {bias:.3f} °C\n95% LoA = {loa_low:.3f} to {loa_high:.3f} °C",
        transform=ax_c.transAxes,
        ha="center",
        va="top",
        fontsize=7,
        bbox=dict(boxstyle="square,pad=0.22", facecolor="white", edgecolor="black", alpha=0.94, linewidth=0.5),
        zorder=8,
    )
else:
    panel_label(ax_c, "(c) Bland–Altman agreement")
    ax_c.text(
        0.97,
        0.05,
        (
            f"95% LoA: {loa_low:.3f} to {loa_high:.3f} °C\n"
            f"r(mean, difference) = {pearsonr(ba_mean, residual).statistic:.3f}"
        ),
        transform=ax_c.transAxes,
        ha="right",
        va="bottom",
        fontsize=8.5,
        bbox=dict(boxstyle="round,pad=0.35", alpha=0.88, linewidth=0.7),
    )
if not args.compact_artwork:
    ax_c.legend(loc="upper right", frameon=False, handlelength=1.5)
clean_axes(ax_c)

panel_c_png = output_dir / "Fig12c_bland_altman.png"
panel_c_svg = output_dir / "Fig12c_bland_altman.svg"
save_panel(fig_c, panel_c_png, panel_c_svg)
plt.close(fig_c)

# ---------------------------------------------------------------------
# Panel (d): Empirical cumulative distribution of absolute errors
# ---------------------------------------------------------------------
def ecdf(values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    x = np.sort(values)
    y = np.arange(1, len(x) + 1) / len(x) * 100
    return x, y

raw_x, raw_y = ecdf(raw_abs)
pred_x, pred_y = ecdf(pred_abs)

fig_d, ax_d = plt.subplots(figsize=panel_size)
ax_d.step(
    raw_x,
    raw_y,
    where="post",
    linewidth=1.2 if args.compact_artwork else 2.2,
    label="Raw",
)
ax_d.step(
    pred_x,
    pred_y,
    where="post",
    linewidth=1.2 if args.compact_artwork else 2.2,
    label="TH-SHRC",
)

for threshold in thresholds:
    ax_d.axvline(threshold, linestyle=":", linewidth=0.6 if args.compact_artwork else 1.0, alpha=0.55)

ax_d.set_xlim(0, 13.2)
ax_d.set_ylim(0, 101)
ax_d.set_xlabel("Absolute error (°C)" if args.compact_artwork else "Absolute error relative to measured\ncore temperature (°C)")
ax_d.set_ylabel("Cumulative (%)" if args.compact_artwork else "Cumulative proportion (%)")
if args.compact_artwork:
    ax_d.text(
        0.97,
        0.07,
        (
            f"|Error| ≤ 0.5 °C\n"
            f"Raw = {threshold_stats[0.5]['raw_pct']:.1f}%\n"
            f"TH-SHRC = {threshold_stats[0.5]['compensated_pct']:.1f}%"
        ),
        transform=ax_d.transAxes,
        ha="right",
        va="bottom",
        fontsize=7,
        bbox=dict(boxstyle="square,pad=0.22", facecolor="white", edgecolor="black", alpha=0.94, linewidth=0.5),
        zorder=8,
    )
else:
    panel_label(ax_d, "(d) Absolute-error cumulative distribution")

if not args.compact_artwork:
    threshold_text = "\n".join(
        [
            (
                f"≤{t:.1f} °C: "
                f"{threshold_stats[t]['compensated_pct']:.1f}% compensated, "
                f"{threshold_stats[t]['raw_pct']:.1f}% raw"
            )
            for t in thresholds
        ]
    )
    ax_d.text(
        0.97,
        0.52,
        threshold_text,
        transform=ax_d.transAxes,
        ha="right",
        va="center",
        fontsize=8,
        bbox=dict(boxstyle="round,pad=0.4", alpha=0.88, linewidth=0.7),
    )
    ax_d.text(
        0.97,
        0.07,
        (
            f"Median absolute error:\n"
            f"Raw = {np.median(raw_abs):.3f} °C\n"
            f"Compensated = {np.median(pred_abs):.3f} °C"
        ),
        transform=ax_d.transAxes,
        ha="right",
        va="bottom",
        fontsize=8,
        bbox=dict(boxstyle="round,pad=0.35", alpha=0.88, linewidth=0.7),
    )
ax_d.legend(loc="upper right", bbox_to_anchor=(1.0, 0.88), frameon=False, handlelength=1.7)
clean_axes(ax_d)

panel_d_png = output_dir / "Fig12d_absolute_error_ecdf.png"
panel_d_svg = output_dir / "Fig12d_absolute_error_ecdf.svg"
save_panel(fig_d, panel_d_png, panel_d_svg)
plt.close(fig_d)

# ---------------------------------------------------------------------
# Combine the four independently generated panels into one 2×2 figure
# ---------------------------------------------------------------------
panel_paths = [panel_a_png, panel_b_png, panel_c_png, panel_d_png]
images = [Image.open(path).convert("RGB") for path in panel_paths]

panel_dimensions = {image.size for image in images}
if len(panel_dimensions) != 1:
    raise ValueError(
        f"Fig. 12 panels must have identical pixel dimensions, found {panel_dimensions}"
    )

target_w, target_h = images[0].size
canvas = Image.new("RGB", (target_w * 2, target_h * 2), "white")
canvas.paste(images[0], (0, 0))
canvas.paste(images[1], (target_w, 0))
canvas.paste(images[2], (0, target_h))
canvas.paste(images[3], (target_w, target_h))

combined_png = output_dir / "Fig12_TH_SHRC_4panel_final.png"
combined_tiff = output_dir / "Fig12_TH_SHRC_4panel_final.tiff"

canvas.save(combined_png, dpi=(600, 600), optimize=True)
canvas.save(combined_tiff, dpi=(600, 600), compression="tiff_lzw")

# ---------------------------------------------------------------------
# Export plot data and performance table
# ---------------------------------------------------------------------
plot_data = data.copy()
plot_data["Raw_temperature_gap_C"] = raw_error
plot_data["Residual_measured_minus_predicted_C"] = residual
plot_data["Raw_absolute_error_C"] = raw_abs
plot_data["Compensated_absolute_error_C"] = pred_abs
plot_data["Bland_Altman_mean_C"] = ba_mean
plot_data.to_csv(
    output_dir / f"Fig12_plot_data_{len(data)}_records.csv",
    index=False,
    encoding="utf-8-sig",
)

performance_table = pd.DataFrame(
    [
        {
            "Method": "Raw ear-surface temperature",
            "R2": r2_score(core, ear),
            "Pearson_r": raw_metrics["Pearson_r"],
            "CCC": raw_metrics["CCC"],
            "RMSE_C": raw_metrics["RMSE_C"],
            "MAE_C": raw_metrics["MAE_C"],
            "Mean_bias_measured_minus_estimated_C": np.mean(raw_error),
            "Lower_95pct_LoA_C": np.mean(raw_error) - 1.96 * np.std(raw_error, ddof=1),
            "Upper_95pct_LoA_C": np.mean(raw_error) + 1.96 * np.std(raw_error, ddof=1),
            "Abs_error_le_0.2_pct": threshold_stats[0.2]["raw_pct"],
            "Abs_error_le_0.3_pct": threshold_stats[0.3]["raw_pct"],
            "Abs_error_le_0.5_pct": threshold_stats[0.5]["raw_pct"],
            "Abs_error_le_1.0_pct": threshold_stats[1.0]["raw_pct"],
        },
        {
            "Method": "TH-SHRC compensated temperature",
            "R2": model_metrics["R2"],
            "Pearson_r": model_metrics["Pearson_r"],
            "CCC": model_metrics["CCC"],
            "RMSE_C": model_metrics["RMSE_C"],
            "MAE_C": model_metrics["MAE_C"],
            "Mean_bias_measured_minus_estimated_C": bias,
            "Lower_95pct_LoA_C": loa_low,
            "Upper_95pct_LoA_C": loa_high,
            "Abs_error_le_0.2_pct": threshold_stats[0.2]["compensated_pct"],
            "Abs_error_le_0.3_pct": threshold_stats[0.3]["compensated_pct"],
            "Abs_error_le_0.5_pct": threshold_stats[0.5]["compensated_pct"],
            "Abs_error_le_1.0_pct": threshold_stats[1.0]["compensated_pct"],
        },
    ]
)
performance_table.to_csv(
    output_dir / "Table_TH_SHRC_performance_and_agreement.csv",
    index=False,
    encoding="utf-8-sig",
)

print("Done.")
