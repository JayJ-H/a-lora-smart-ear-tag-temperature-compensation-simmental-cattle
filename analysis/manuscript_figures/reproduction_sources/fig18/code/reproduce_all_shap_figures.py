from __future__ import annotations

from pathlib import Path
import argparse

import matplotlib.pyplot as plt
from matplotlib.colors import Normalize
import numpy as np
import pandas as pd
from statsmodels.nonparametric.smoothers_lowess import lowess


DISPLAY = {
    "Time": "Sampling time / temporal state",
    "Ear": "Ear-surface temperature",
    "CowID_raw": "Cattle identity",
    "Air": "Local ambient temperature",
}

COMPACT_DISPLAY = {
    "Time": "Temporal state",
    "Ear": "Ear T",
    "CowID_raw": "Cow ID",
    "Air": "Ambient T",
}

SHAP_COLUMN = {
    "Time": "SHAP_Time",
    "Ear": "SHAP_Ear",
    "CowID_raw": "SHAP_CowID",
    "Air": "SHAP_Air",
}

VALUE_COLUMN = {
    "Time": "Time",
    "Ear": "Ear",
    "Air": "Air",
}
PUBLICATION_LAYOUT = False
COMPACT_ARTWORK = False


def mm_size(width_mm: float, height_mm: float) -> tuple[float, float]:
    return width_mm / 25.4, height_mm / 25.4


def configure_style() -> None:
    plt.rcParams.update(
        {
            "font.family": "serif",
            "font.serif": [
                "Times New Roman",
                "Liberation Serif",
                "DejaVu Serif",
            ],
            "font.size": 10,
            "axes.labelsize": 11,
            "axes.titlesize": 12,
            "xtick.labelsize": 9,
            "ytick.labelsize": 9.5,
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
                "axes.labelsize": 7.5,
                "axes.titlesize": 7.5,
                "xtick.labelsize": 7,
                "ytick.labelsize": 7,
                "axes.linewidth": 0.7,
            }
        )


def clean_axes(ax: plt.Axes, grid_axis: str | None = None) -> None:
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    if grid_axis:
        ax.grid(
            axis=grid_axis,
            color="#D9D9D9",
            linewidth=0.55,
            alpha=0.65,
        )


def save_all(fig: plt.Figure, output_dir: Path, stem: str) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    bbox = None if PUBLICATION_LAYOUT else "tight"
    fig.savefig(
        output_dir / f"{stem}.png",
        dpi=600,
        bbox_inches=bbox,
        facecolor="white",
    )
    fig.savefig(
        output_dir / f"{stem}.tiff",
        dpi=600,
        bbox_inches=bbox,
        facecolor="white",
        pil_kwargs={"compression": "tiff_lzw"},
    )
    fig.savefig(
        output_dir / f"{stem}.svg",
        bbox_inches=bbox,
        facecolor="white",
    )
    fig.savefig(
        output_dir / f"{stem}.pdf",
        bbox_inches=bbox,
        facecolor="white",
    )
    plt.close(fig)


def scale_01(values: np.ndarray) -> np.ndarray:
    values = np.asarray(values, dtype=float)
    finite = np.isfinite(values)
    if not finite.any():
        return np.full(values.shape, 0.5)

    low = np.nanpercentile(values[finite], 2)
    high = np.nanpercentile(values[finite], 98)
    if high <= low:
        return np.full(values.shape, 0.5)

    return np.clip((values - low) / (high - low), 0, 1)


def load_data(package_root: Path):
    data_dir = package_root / "data"

    shap = pd.read_csv(
        data_dir / "SHAP_wide.csv",
        index_col="TargetRowID",
    )
    summary = pd.read_csv(data_dir / "SHAP_summary.csv")
    check = pd.read_csv(
        data_dir / "SHAP_additivity_check.csv",
        index_col="TargetRowID",
    )
    rows = pd.read_csv(
        data_dir / "plotting_rows.csv",
        index_col="TargetRowID",
    )

    shap = shap.reindex(rows.index)
    check = check.reindex(rows.index)

    if shap.isna().any().any():
        raise ValueError("SHAP data contain missing values after alignment.")
    if check["FullPipelinePrediction_C"].isna().any():
        raise ValueError("Prediction check contains missing values.")

    return shap, summary, check, rows


def make_heatmap(
    shap: pd.DataFrame,
    summary: pd.DataFrame,
    check: pd.DataFrame,
    rows: pd.DataFrame,
    output_dir: Path,
) -> None:
    feature_order = (
        summary.sort_values("MeanAbsSHAP_C", ascending=False)
        ["FeatureGroup"]
        .tolist()
    )

    cow_code = pd.factorize(
        rows["CowID"].astype(str),
        sort=True,
    )[0]

    ordering = pd.DataFrame(
        {
            "Cow": cow_code,
            "Time": pd.to_numeric(rows["Time"], errors="coerce"),
            "Prediction": pd.to_numeric(
                check["FullPipelinePrediction_C"],
                errors="coerce",
            ),
        },
        index=rows.index,
    )

    ordered_index = ordering.sort_values(
        ["Cow", "Time", "Prediction"]
    ).index

    heat_matrix = shap.loc[
        ordered_index,
        feature_order,
    ].T.to_numpy(float)

    predicted = check.loc[
        ordered_index,
        "FullPipelinePrediction_C",
    ].to_numpy(float)

    max_abs = float(np.nanmax(np.abs(heat_matrix)))
    x = np.arange(len(ordered_index))

    fig = plt.figure(figsize=mm_size(190, 85.7) if PUBLICATION_LAYOUT else (11.2, 5.6))
    if COMPACT_ARTWORK:
        fig.subplots_adjust(left=0.16, right=0.91, bottom=0.14, top=0.97)
    elif PUBLICATION_LAYOUT:
        fig.subplots_adjust(left=0.24, right=0.88, bottom=0.19, top=0.84)
    grid = fig.add_gridspec(
        2,
        1,
        height_ratios=[1.0, 3.5],
        hspace=0.05,
    )

    ax_top = fig.add_subplot(grid[0, 0])
    ax_top.plot(x, predicted, linewidth=0.8 if COMPACT_ARTWORK else 1.15, color="black")
    ax_top.set_ylabel("Core T\n(°C)" if COMPACT_ARTWORK else "Predicted core\nT (°C)")
    if not COMPACT_ARTWORK:
        ax_top.set_title(f"Conditional SHAP heatmap across {len(rows)} out-of-fold samples")
    ax_top.tick_params(axis="x", labelbottom=False)
    ax_top.grid(alpha=0.14, linewidth=0.5)
    clean_axes(ax_top)

    ax_heat = fig.add_subplot(grid[1, 0], sharex=ax_top)
    image = ax_heat.imshow(
        heat_matrix,
        aspect="auto",
        interpolation="nearest",
        cmap="coolwarm",
        vmin=-max_abs,
        vmax=max_abs,
    )
    ax_heat.set_yticks(
        np.arange(len(feature_order)),
        [(COMPACT_DISPLAY if COMPACT_ARTWORK else DISPLAY)[name] for name in feature_order],
    )
    ax_heat.set_xlabel("Ordered samples" if COMPACT_ARTWORK else "Instances ordered by cattle identity and sampling time")
    ax_heat.set_ylabel("Feature" if COMPACT_ARTWORK else "Feature group")
    clean_axes(ax_heat)

    colorbar = fig.colorbar(
        image,
        ax=[ax_top, ax_heat],
        fraction=0.025,
        pad=0.018,
    )
    colorbar.set_label("SHAP (°C)" if COMPACT_ARTWORK else "Conditional SHAP value (°C)")

    save_all(fig, output_dir, "Fig18a_conditional_SHAP_heatmap")


def make_global_contribution(
    summary: pd.DataFrame,
    rows: pd.DataFrame,
    output_dir: Path,
) -> None:
    feature_order = (
        summary.sort_values("MeanAbsSHAP_C", ascending=False)
        ["FeatureGroup"]
        .tolist()
    )
    summary_index = summary.set_index("FeatureGroup")

    all_values = np.concatenate(
        [
            rows[SHAP_COLUMN[name]].to_numpy(float)
            for name in feature_order
        ]
    )
    x_limit = float(np.nanmax(np.abs(all_values))) * 1.08
    bar_values = [
        float(summary_index.loc[name, "MeanAbsSHAP_C"])
        for name in feature_order
    ]

    fig, ax_bar = plt.subplots(figsize=mm_size(190, 119.5) if PUBLICATION_LAYOUT else (9.4, 5.6))
    if COMPACT_ARTWORK:
        fig.subplots_adjust(left=0.16, right=0.90, bottom=0.13, top=0.91)
    elif PUBLICATION_LAYOUT:
        fig.subplots_adjust(left=0.24, right=0.86, bottom=0.16, top=0.84)
    ax_shap = ax_bar.twiny()

    y_positions = np.arange(len(feature_order))
    ax_bar.barh(
        y_positions,
        bar_values,
        height=0.68,
        color="mistyrose",
        edgecolor="lightcoral",
        linewidth=0.8,
        alpha=0.58,
    )
    ax_bar.set_xlim(0, max(bar_values) * 1.22)
    ax_bar.set_xlabel("Mean |SHAP| (°C)" if COMPACT_ARTWORK else "Mean |conditional SHAP value| (°C)")
    ax_bar.set_yticks(
        y_positions,
        [(COMPACT_DISPLAY if COMPACT_ARTWORK else DISPLAY)[name] for name in feature_order],
    )
    ax_bar.invert_yaxis()
    clean_axes(ax_bar, "x")

    ax_shap.set_xlim(-x_limit, x_limit)
    ax_shap.set_ylim(ax_bar.get_ylim())
    ax_shap.set_xlabel("SHAP value (°C)" if COMPACT_ARTWORK else "Conditional SHAP value (impact on predicted core temperature, °C)")
    ax_shap.axvline(
        0,
        linestyle="--",
        linewidth=0.9,
        color="black",
    )
    ax_shap.tick_params(
        axis="y",
        which="both",
        left=False,
        right=False,
        labelleft=False,
        labelright=False,
    )

    rng = np.random.default_rng(20260723)
    cmap = plt.cm.coolwarm
    norm = Normalize(0, 1)
    mappable = None

    for row_number, feature_name in enumerate(feature_order):
        ax_bar.text(
            bar_values[row_number] + max(bar_values) * 0.012,
            row_number,
            f"{bar_values[row_number]:.3f}",
            va="center",
            ha="left",
            fontsize=7 if COMPACT_ARTWORK else 8.5,
        )

        shap_values = rows[
            SHAP_COLUMN[feature_name]
        ].to_numpy(float)

        y_values = np.full(
            len(rows),
            float(row_number),
            dtype=float,
        )
        y_values += rng.normal(0, 0.105, len(rows))

        if feature_name == "CowID_raw":
            ax_shap.scatter(
                shap_values,
                y_values,
                s=5 if COMPACT_ARTWORK else 18,
                alpha=0.48 if COMPACT_ARTWORK else 0.56,
                linewidths=0,
                color="gray",
                rasterized=True,
            )
        else:
            raw_values = rows[
                VALUE_COLUMN[feature_name]
            ].to_numpy(float)
            mappable = ax_shap.scatter(
                shap_values,
                y_values,
                c=scale_01(raw_values),
                cmap=cmap,
                norm=norm,
                s=5 if COMPACT_ARTWORK else 18,
                alpha=0.58 if COMPACT_ARTWORK else 0.74,
                linewidths=0,
                rasterized=True,
            )

    if not COMPACT_ARTWORK:
        ax_bar.set_title("Global SHAP contribution and sample-level effect distribution")

    colorbar = fig.colorbar(
        mappable,
        ax=[ax_bar, ax_shap],
        fraction=0.030,
        pad=0.025,
    )
    colorbar.set_label("Feature value" if COMPACT_ARTWORK else "Continuous feature value")
    colorbar.set_ticks([0, 1])
    colorbar.set_ticklabels(["Low", "High"])

    if not COMPACT_ARTWORK:
        ax_bar.text(0.99, 0.02, "Cattle identity is categorical and is shown in gray.", transform=ax_bar.transAxes, ha="right", va="bottom", fontsize=8.5)

    save_all(
        fig,
        output_dir,
        "Fig18b_global_SHAP_contribution",
    )


def make_dependence_panel(
    rows: pd.DataFrame,
    output_dir: Path,
    stem: str,
    x_column: str,
    shap_column: str,
    color_column: str,
    x_label: str,
    color_label: str,
    title: str,
    lowess_fraction: float,
) -> None:
    x = pd.to_numeric(rows[x_column], errors="coerce").to_numpy(float)
    y = pd.to_numeric(rows[shap_column], errors="coerce").to_numpy(float)
    color = pd.to_numeric(
        rows[color_column],
        errors="coerce",
    ).to_numpy(float)

    valid = np.isfinite(x) & np.isfinite(y)
    smooth = lowess(
        y[valid],
        x[valid],
        frac=lowess_fraction,
        it=1,
        return_sorted=True,
    )

    fig, ax = plt.subplots(figsize=mm_size(63.333, 70) if PUBLICATION_LAYOUT else (6.3, 5.0))
    scatter = ax.scatter(
        x,
        y,
        c=color,
        cmap="coolwarm",
        s=5 if COMPACT_ARTWORK else 22,
        alpha=0.48 if COMPACT_ARTWORK else 0.62,
        linewidths=0,
        rasterized=True,
    )
    ax.plot(
        smooth[:, 0],
        smooth[:, 1],
        color="crimson",
        linewidth=0.9 if COMPACT_ARTWORK else 2.5,
    )
    ax.axhline(
        0,
        color="black",
        linestyle="--",
        linewidth=0.8,
    )
    if COMPACT_ARTWORK and x_label.startswith("Ear-surface"):
        x_label = "Ear T (°C)"
    elif COMPACT_ARTWORK and x_label.startswith("Local ambient"):
        x_label = "Ambient T (°C)"
    elif PUBLICATION_LAYOUT and x_label.startswith("Ear-surface"):
        x_label = "Ear-surface\ntemperature (°C)"
    elif PUBLICATION_LAYOUT and x_label.startswith("Local ambient"):
        x_label = "Local ambient\ntemperature (°C)"
    ax.set_xlabel(x_label, fontsize=7.5 if COMPACT_ARTWORK else (9 if PUBLICATION_LAYOUT else None))
    ax.set_ylabel(
        "SHAP (°C)"
        if COMPACT_ARTWORK
        else "SHAP value (°C)"
        if PUBLICATION_LAYOUT
        else "Conditional SHAP value\n(impact on predicted core\ntemperature, °C)"
    )
    if not COMPACT_ARTWORK:
        ax.set_title(title, pad=8, fontsize=10 if PUBLICATION_LAYOUT else None)
    ax.grid(alpha=0.14, linewidth=0.5)
    clean_axes(ax)

    colorbar = fig.colorbar(
        scatter,
        ax=ax,
        fraction=0.065 if PUBLICATION_LAYOUT else 0.045,
        pad=0.04 if PUBLICATION_LAYOUT else 0.025,
    )
    if COMPACT_ARTWORK:
        compact_color_labels = {
            "Ear–ambient thermal gradient (°C)": "T gap (°C)",
            "Sampling time (h)": "Time (h)",
            "Local ambient temperature (°C)": "Ambient T (°C)",
        }
        colorbar.set_label(compact_color_labels.get(color_label, color_label), fontsize=7)
    elif PUBLICATION_LAYOUT:
        compact_color_labels = {
            "Ear–ambient thermal gradient (°C)": "Ear–ambient\ngradient (°C)",
            "Sampling time (h)": "Sampling\ntime (h)",
            "Local ambient temperature (°C)": "Ambient\ntemperature (°C)",
        }
        colorbar.set_label(compact_color_labels.get(color_label, color_label), fontsize=8)
    else:
        colorbar.set_label(color_label)

    if COMPACT_ARTWORK:
        fig.subplots_adjust(left=0.18, right=0.82, bottom=0.18, top=0.97)
    elif PUBLICATION_LAYOUT:
        fig.subplots_adjust(left=0.20, right=0.79, bottom=0.22, top=0.83)

    save_all(fig, output_dir, stem)


def make_importance_bar(
    summary: pd.DataFrame,
    output_dir: Path,
) -> None:
    data = summary.sort_values(
        "MeanAbsSHAP_C",
        ascending=True,
    ).copy()

    values = data["MeanAbsSHAP_C"].to_numpy(float)
    colors = plt.cm.Spectral_r(
        np.linspace(0.15, 0.85, len(data))
    )

    fig, ax = plt.subplots(figsize=(8.2, 4.9))
    bars = ax.barh(
        np.arange(len(data)),
        values,
        color=colors,
        height=0.68,
        edgecolor="none",
    )

    ax.set_yticks(
        np.arange(len(data)),
        [DISPLAY[name] for name in data["FeatureGroup"]],
    )
    ax.set_xlabel("Mean |conditional SHAP value| (°C)")
    ax.set_title("Global feature importance")
    clean_axes(ax, "x")
    ax.set_xlim(0, max(values) * 1.24)

    for bar, value in zip(bars, values):
        ax.text(
            value + max(values) * 0.018,
            bar.get_y() + bar.get_height() / 2,
            f"{value:.3f}",
            va="center",
            fontsize=10,
        )

    save_all(
        fig,
        output_dir,
        "Fig17_mean_absolute_SHAP_bar",
    )


def make_combined_figures(
    package_root: Path,
    output_dir: Path,
) -> None:
    """Build the two manuscript composite figures from regenerated PNGs."""
    from PIL import Image, ImageDraw, ImageFont

    fig15a = Image.open(
        output_dir / "Fig18a_conditional_SHAP_heatmap.png"
    ).convert("RGB")
    fig15b = Image.open(
        output_dir / "Fig18b_global_SHAP_contribution.png"
    ).convert("RGB")

    target_width = max(fig15a.width, fig15b.width)
    fig15a = fig15a.resize(
        (
            target_width,
            round(fig15a.height * target_width / fig15a.width),
        ),
        Image.Resampling.LANCZOS,
    )
    fig15b = fig15b.resize(
        (
            target_width,
            round(fig15b.height * target_width / fig15b.width),
        ),
        Image.Resampling.LANCZOS,
    )

    margin = 90
    gap = 100
    canvas = Image.new(
        "RGB",
        (
            target_width + 2 * margin,
            fig15a.height + fig15b.height + gap + 2 * margin,
        ),
        "white",
    )
    canvas.paste(fig15a, (margin, margin))
    canvas.paste(
        fig15b,
        (margin, margin + fig15a.height + gap),
    )

    font_candidates = [
        r"C:\Windows\Fonts\timesbd.ttf",
        r"C:\Windows\Fonts\arialbd.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
    ]
    font_path = next(
        (path for path in font_candidates if Path(path).exists()),
        None,
    )
    font = (
        ImageFont.truetype(font_path, 92)
        if font_path
        else ImageFont.load_default()
    )
    draw = ImageDraw.Draw(canvas)
    draw.text((25, 25), "a", fill="black", font=font)
    draw.text(
        (25, margin + fig15a.height + gap + 10),
        "b",
        fill="black",
        font=font,
    )

    canvas.save(
        output_dir / "Fig18_group_SHAP_analysis.png",
        dpi=(600, 600),
    )
    canvas.save(
        output_dir / "Fig18_group_SHAP_analysis.tiff",
        dpi=(600, 600),
        compression="tiff_lzw",
    )
    canvas.save(
        output_dir / "Fig18_group_SHAP_analysis.pdf",
        resolution=600,
    )

    panel_files = [
        output_dir / "Fig19a_ear_temperature_dependence.png",
        output_dir / "Fig19b_ambient_temperature_dependence.png",
        output_dir / "Fig19c_sampling_time_dependence.png",
    ]
    panels = [
        Image.open(path).convert("RGB")
        for path in panel_files
    ]
    max_height = max(panel.height for panel in panels)
    resized = []
    for panel in panels:
        if panel.height != max_height:
            panel = panel.resize(
                (
                    round(panel.width * max_height / panel.height),
                    max_height,
                ),
                Image.Resampling.LANCZOS,
            )
        resized.append(panel)

    gap = 100
    margin = 50
    dependence_canvas = Image.new(
        "RGB",
        (
            sum(panel.width for panel in resized)
            + gap * 2
            + margin * 2,
            max_height + margin * 2,
        ),
        "white",
    )

    x_cursor = margin
    draw = ImageDraw.Draw(dependence_canvas)
    panel_font = (
        ImageFont.truetype(font_path, 76)
        if font_path
        else ImageFont.load_default()
    )
    for label, panel in zip(("a", "b", "c"), resized):
        dependence_canvas.paste(panel, (x_cursor, margin))
        draw.text((x_cursor + 8, 8), label, fill="black", font=panel_font)
        x_cursor += panel.width + gap

    dependence_canvas.save(
        output_dir / "Fig19_SHAP_dependence_analysis.png",
        dpi=(600, 600),
    )
    dependence_canvas.save(
        output_dir / "Fig19_SHAP_dependence_analysis.tiff",
        dpi=(600, 600),
        compression="tiff_lzw",
    )
    dependence_canvas.save(
        output_dir / "Fig19_SHAP_dependence_analysis.pdf",
        resolution=600,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Regenerate all TH-SHRC SHAP figures."
    )
    parser.add_argument(
        "--package-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Root directory containing 数据/ and 图件/.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Output figure directory. Defaults to <package-root>/figures_reproduced.",
    )
    parser.add_argument(
        "--publication-layout",
        action="store_true",
        help="Export Fig. 18 at 190 mm and Fig. 19 panels at 63.333 mm widths.",
    )
    parser.add_argument(
        "--compact-artwork",
        action="store_true",
        help="Remove titles and use compact 7 pt publication styling.",
    )
    args = parser.parse_args()

    global PUBLICATION_LAYOUT, COMPACT_ARTWORK
    PUBLICATION_LAYOUT = args.publication_layout
    COMPACT_ARTWORK = args.compact_artwork

    package_root = args.package_root.resolve()
    output_dir = (
        args.output_dir.resolve()
        if args.output_dir
        else package_root / "figures_reproduced"
    )
    output_dir.mkdir(parents=True, exist_ok=True)

    configure_style()
    shap, summary, check, rows = load_data(package_root)

    make_heatmap(shap, summary, check, rows, output_dir)
    make_global_contribution(summary, rows, output_dir)

    make_dependence_panel(
        rows,
        output_dir,
        "Fig19a_ear_temperature_dependence",
        "Ear",
        "SHAP_Ear",
        "EarAirGap",
        "Ear-surface temperature (°C)",
        "Ear–ambient thermal gradient (°C)",
        "Ear-surface temperature",
        0.28,
    )
    make_dependence_panel(
        rows,
        output_dir,
        "Fig19b_ambient_temperature_dependence",
        "Air",
        "SHAP_Air",
        "Time",
        "Local ambient temperature (°C)",
        "Sampling time (h)",
        "Local ambient temperature",
        0.30,
    )
    make_dependence_panel(
        rows,
        output_dir,
        "Fig19c_sampling_time_dependence",
        "Time",
        "SHAP_Time",
        "Air",
        "Sampling time (h)",
        "Local ambient temperature (°C)",
        "Sampling time / temporal state",
        0.34,
    )

    make_combined_figures(package_root, output_dir)

    max_diff = float(
        check["AdditivityDifference_C"].abs().max()
    )
    print(f"Figures written to: {output_dir}")
    print(f"Maximum SHAP additivity difference: {max_diff:.12g} °C")


if __name__ == "__main__":
    main()
