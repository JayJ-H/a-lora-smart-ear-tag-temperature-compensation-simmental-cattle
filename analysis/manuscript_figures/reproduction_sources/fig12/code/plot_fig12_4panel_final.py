from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from PIL import Image
from scipy.stats import gaussian_kde, linregress, pearsonr
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from statsmodels.nonparametric.smoothers_lowess import lowess

# ---------------------------------------------------------------------
# Input and output paths
# ---------------------------------------------------------------------
ROOT = Path(__file__).resolve().parents[5]
csv_path = ROOT / "data/processed/th_shrc_oof_predictions.csv"
output_dir = Path(__file__).resolve().parents[1] / "outputs"
output_dir.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------
# Load the final 503-record dataset
# ---------------------------------------------------------------------
df = pd.read_csv(csv_path)

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

if len(data) != 503:
    raise ValueError(f"Expected 503 complete paired records, found {len(data)}")

ear = data["Ear_surface_temperature_C"].to_numpy()
core = data["Measured_core_temperature_C"].to_numpy()
pred = data["Predicted_core_temperature_C"].to_numpy()

raw_error = core - ear
residual = core - pred
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

panel_size = (8.0, 6.67)
panel_dpi = 300

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
        fontsize=11.5,
        fontweight="bold",
    )

def clean_axes(ax) -> None:
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(alpha=0.18, linewidth=0.6)

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
    s=28,
    alpha=0.82,
    linewidths=0.2,
)
ax_a.plot([37.3, 41.7], [37.3, 41.7], linestyle="--", linewidth=1.4, label="Line of identity")

smooth_a = lowess(ear, core, frac=0.36, return_sorted=True)
ax_a.plot(
    smooth_a[:, 0],
    smooth_a[:, 1],
    linewidth=2.0,
    label="LOWESS trend",
)

ax_a.set_xlim(37.3, 41.7)
ax_a.set_ylim(24.5, 40.5)
ax_a.set_xlabel("Measured core temperature (°C)")
ax_a.set_ylabel("Raw ear-surface temperature (°C)")
panel_label(ax_a, "(a) Before compensation")
ax_a.text(
    0.97,
    0.05,
    (
        f"r = {raw_metrics['Pearson_r']:.3f}\n"
        f"RMSE = {raw_metrics['RMSE_C']:.3f} °C\n"
        f"MAE = {raw_metrics['MAE_C']:.3f} °C"
    ),
    transform=ax_a.transAxes,
    ha="right",
    va="bottom",
    bbox=dict(boxstyle="round,pad=0.35", alpha=0.88, linewidth=0.7),
)
ax_a.legend(loc="upper right", frameon=False)
clean_axes(ax_a)

panel_a_png = output_dir / "Fig12a_before_compensation.png"
panel_a_svg = output_dir / "Fig12a_before_compensation.svg"
fig_a.savefig(panel_a_png, dpi=panel_dpi, bbox_inches="tight", facecolor="white")
fig_a.savefig(panel_a_svg, bbox_inches="tight", facecolor="white")
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
    s=28,
    alpha=0.82,
    linewidths=0.2,
)

axis_min, axis_max = 37.3, 41.7
ax_b.plot(
    [axis_min, axis_max],
    [axis_min, axis_max],
    linestyle="--",
    linewidth=1.4,
    label="Line of identity",
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

ax_b.plot(x_grid, y_fit, linewidth=2.0, label="Linear fit")
ax_b.fill_between(x_grid, y_fit - ci, y_fit + ci, alpha=0.16, linewidth=0)

ax_b.set_xlim(axis_min, axis_max)
ax_b.set_ylim(axis_min, axis_max)
ax_b.set_aspect("equal", adjustable="box")
ax_b.set_xlabel("Measured core temperature (°C)")
ax_b.set_ylabel("Predicted core temperature (°C)")
panel_label(ax_b, "(b) After TH-SHRC compensation")
ax_b.text(
    0.97,
    0.05,
    (
        f"$R^2$ = {model_metrics['R2']:.3f}\n"
        f"RMSE = {model_metrics['RMSE_C']:.3f} °C\n"
        f"MAE = {model_metrics['MAE_C']:.3f} °C\n"
        f"CCC = {model_metrics['CCC']:.3f}"
    ),
    transform=ax_b.transAxes,
    ha="right",
    va="bottom",
    bbox=dict(boxstyle="round,pad=0.35", alpha=0.88, linewidth=0.7),
)
ax_b.legend(loc="lower left", frameon=False)
clean_axes(ax_b)

panel_b_png = output_dir / "Fig12b_after_compensation.png"
panel_b_svg = output_dir / "Fig12b_after_compensation.svg"
fig_b.savefig(panel_b_png, dpi=panel_dpi, bbox_inches="tight", facecolor="white")
fig_b.savefig(panel_b_svg, bbox_inches="tight", facecolor="white")
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
    s=28,
    alpha=0.82,
    linewidths=0.2,
)

ax_c.axhline(bias, linewidth=1.8, label=f"Bias = {bias:.3f} °C")
ax_c.axhline(
    loa_low,
    linestyle="--",
    linewidth=1.5,
    label=f"Lower LoA = {loa_low:.3f} °C",
)
ax_c.axhline(
    loa_high,
    linestyle="--",
    linewidth=1.5,
    label=f"Upper LoA = {loa_high:.3f} °C",
)

# ±0.5 °C reference band
ax_c.axhspan(-0.5, 0.5, alpha=0.07, linewidth=0)

ax_c.set_xlabel("Mean of measured and predicted core temperature (°C)")
ax_c.set_ylabel("Difference: measured − predicted (°C)")
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
    bbox=dict(boxstyle="round,pad=0.35", alpha=0.88, linewidth=0.7),
)
ax_c.legend(loc="upper right", frameon=False)
clean_axes(ax_c)

panel_c_png = output_dir / "Fig12c_bland_altman_standard.png"
panel_c_svg = output_dir / "Fig12c_bland_altman_standard.svg"
fig_c.savefig(panel_c_png, dpi=panel_dpi, bbox_inches="tight", facecolor="white")
fig_c.savefig(panel_c_svg, bbox_inches="tight", facecolor="white")
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
    linewidth=2.2,
    label="Raw ear-surface temperature",
)
ax_d.step(
    pred_x,
    pred_y,
    where="post",
    linewidth=2.2,
    label="TH-SHRC compensated temperature",
)

for threshold in thresholds:
    ax_d.axvline(threshold, linestyle=":", linewidth=1.0, alpha=0.55)

ax_d.set_xlim(0, 13.2)
ax_d.set_ylim(0, 101)
ax_d.set_xlabel("Absolute error relative to measured core temperature (°C)")
ax_d.set_ylabel("Cumulative proportion (%)")
panel_label(ax_d, "(d) Absolute-error cumulative distribution")

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
    bbox=dict(boxstyle="round,pad=0.35", alpha=0.88, linewidth=0.7),
)
ax_d.legend(loc="center right", bbox_to_anchor=(0.98, 0.34), frameon=False)
clean_axes(ax_d)

panel_d_png = output_dir / "Fig12d_absolute_error_ecdf.png"
panel_d_svg = output_dir / "Fig12d_absolute_error_ecdf.svg"
fig_d.savefig(panel_d_png, dpi=panel_dpi, bbox_inches="tight", facecolor="white")
fig_d.savefig(panel_d_svg, bbox_inches="tight", facecolor="white")
plt.close(fig_d)

# ---------------------------------------------------------------------
# Combine the four independently generated panels into one 2×2 figure
# ---------------------------------------------------------------------
panel_paths = [panel_a_png, panel_b_png, panel_c_png, panel_d_png]
images = [Image.open(path).convert("RGB") for path in panel_paths]

target_w, target_h = 2400, 2000
resized = [
    image.resize((target_w, target_h), Image.Resampling.LANCZOS)
    for image in images
]

canvas = Image.new("RGB", (target_w * 2, target_h * 2), "white")
canvas.paste(resized[0], (0, 0))
canvas.paste(resized[1], (target_w, 0))
canvas.paste(resized[2], (0, target_h))
canvas.paste(resized[3], (target_w, target_h))

combined_png = output_dir / "Fig12_TH_SHRC_4panel_final.png"
combined_tiff = output_dir / "Fig12_TH_SHRC_4panel_final.tiff"

canvas.save(combined_png, dpi=(600, 600), optimize=True)
canvas.save(combined_tiff, dpi=(600, 600), compression="tiff_lzw")

print("Done.")
