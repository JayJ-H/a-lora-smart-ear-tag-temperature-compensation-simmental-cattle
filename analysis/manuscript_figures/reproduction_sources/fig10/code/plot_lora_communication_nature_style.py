#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generate Nature-inspired LoRa communication-performance figures from SAT_RSSI_SNR.xlsx.

Outputs
-------
Fig10b_PDR_NatureStyle.{png,pdf,svg}
Fig10c_RSSI_NatureStyle.{png,pdf,svg}
Fig10d_SNR_NatureStyle.{png,pdf,svg}
Fig10bcd_NatureStyle_preview.{png,pdf,svg}

Usage
-----
python plot_lora_communication_nature_style.py \
    --input SAT_RSSI_SNR.xlsx \
    --output lora_comm_figures_nature
"""

from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd


RAW_SHEET = "CN_S6_RSSI原始4000行"
REQUIRED_COLUMNS = {
    "距离_m",
    "方向",
    "是否接收",
    "RSSI_dBm",
    "SNR_dB",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate Nature-inspired LoRa PDR, RSSI and SNR panels."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("SAT_RSSI_SNR.xlsx"),
        help="Path to SAT_RSSI_SNR.xlsx.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("lora_comm_figures_nature"),
        help="Directory for output figures.",
    )
    return parser.parse_args()


def load_data(input_path: Path) -> pd.DataFrame:
    if not input_path.exists():
        raise FileNotFoundError(f"Input workbook not found: {input_path}")

    workbook = pd.ExcelFile(input_path)
    if RAW_SHEET not in workbook.sheet_names:
        raise ValueError(
            f"Required sheet '{RAW_SHEET}' was not found. "
            f"Available sheets: {workbook.sheet_names}"
        )

    data = pd.read_excel(input_path, sheet_name=RAW_SHEET)

    missing = REQUIRED_COLUMNS.difference(data.columns)
    if missing:
        raise ValueError(f"Missing required columns: {sorted(missing)}")

    data = data.copy()
    data["距离_m"] = pd.to_numeric(data["距离_m"], errors="coerce")
    data["RSSI_dBm"] = pd.to_numeric(data["RSSI_dBm"], errors="coerce")
    data["SNR_dB"] = pd.to_numeric(data["SNR_dB"], errors="coerce")

    data = data.dropna(subset=["距离_m", "方向", "是否接收"])
    data["是否接收"] = data["是否接收"].astype(str).str.strip()

    valid_status = {"是", "否"}
    unexpected = set(data["是否接收"].unique()).difference(valid_status)
    if unexpected:
        raise ValueError(f"Unexpected values in '是否接收': {sorted(unexpected)}")

    return data


def configure_style() -> None:
    """Compact, restrained publication style."""
    plt.rcParams.update(
        {
            "font.family": "sans-serif",
            "font.sans-serif": ["Arial", "Helvetica", "DejaVu Sans"],
            "font.size": 7,
            "axes.labelsize": 7,
            "xtick.labelsize": 6.5,
            "ytick.labelsize": 6.5,
            "axes.linewidth": 0.65,
            "xtick.major.width": 0.65,
            "ytick.major.width": 0.65,
            "xtick.major.size": 3,
            "ytick.major.size": 3,
            "pdf.fonttype": 42,
            "ps.fonttype": 42,
            "svg.fonttype": "none",
        }
    )


def clean_axes(ax: plt.Axes) -> None:
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.tick_params(direction="out")
    ax.set_axisbelow(True)
    ax.grid(axis="y", color="#E8E8E8", linewidth=0.45)


def panel_label(ax: plt.Axes, letter: str) -> None:
    ax.text(
        -0.16,
        1.04,
        letter,
        transform=ax.transAxes,
        fontsize=8,
        fontweight="bold",
        va="bottom",
        ha="left",
        clip_on=False,
    )


def save_figure(fig: plt.Figure, output_dir: Path, stem: str) -> None:
    for extension in ("png", "pdf", "svg"):
        kwargs = {"bbox_inches": "tight", "facecolor": "white"}
        if extension == "png":
            kwargs["dpi"] = 600
        fig.savefig(output_dir / f"{stem}.{extension}", **kwargs)
    plt.close(fig)


def calculate_summaries(data: pd.DataFrame):
    distances = np.array(sorted(data["距离_m"].unique()))
    received = data[data["是否接收"] == "是"].copy()

    direction_pdr = (
        data.groupby(["距离_m", "方向"])["是否接收"]
        .apply(lambda values: 100.0 * (values == "是").mean())
        .reset_index(name="PDR")
    )

    direction_rssi = (
        received.groupby(["距离_m", "方向"])["RSSI_dBm"]
        .mean()
        .reset_index(name="RSSI")
    )

    direction_snr = (
        received.groupby(["距离_m", "方向"])["SNR_dB"]
        .mean()
        .reset_index(name="SNR")
    )

    overall_pdr = np.array(
        [
            100.0
            * (
                data.loc[data["距离_m"] == distance, "是否接收"]
                == "是"
            ).mean()
            for distance in distances
        ]
    )

    # 95% confidence interval across the eight direction-level PDR values.
    pdr_ci = []
    for distance in distances:
        values = direction_pdr.loc[
            direction_pdr["距离_m"] == distance, "PDR"
        ].to_numpy()
        if len(values) < 2:
            pdr_ci.append(0.0)
        else:
            standard_error = values.std(ddof=1) / np.sqrt(len(values))
            pdr_ci.append(1.96 * standard_error)
    pdr_ci = np.asarray(pdr_ci)

    rssi_groups = [
        received.loc[
            received["距离_m"] == distance, "RSSI_dBm"
        ].dropna().to_numpy()
        for distance in distances
    ]

    snr_groups = [
        received.loc[
            received["距离_m"] == distance, "SNR_dB"
        ].dropna().to_numpy()
        for distance in distances
    ]

    if any(len(group) == 0 for group in rssi_groups):
        raise ValueError("At least one distance has no valid received RSSI records.")
    if any(len(group) == 0 for group in snr_groups):
        raise ValueError("At least one distance has no valid received SNR records.")

    return {
        "distances": distances,
        "received": received,
        "direction_pdr": direction_pdr,
        "direction_rssi": direction_rssi,
        "direction_snr": direction_snr,
        "overall_pdr": overall_pdr,
        "pdr_ci": pdr_ci,
        "rssi_groups": rssi_groups,
        "snr_groups": snr_groups,
    }


def draw_pdr_panel(ax: plt.Axes, summary: dict) -> None:
    distances = summary["distances"]
    direction_pdr = summary["direction_pdr"]
    overall_pdr = summary["overall_pdr"]
    pdr_ci = summary["pdr_ci"]

    accent = "#2474B5"
    point_gray = "#737373"

    x = np.arange(len(distances))
    random_generator = np.random.default_rng(20260722)

    for index, distance in enumerate(distances):
        values = direction_pdr.loc[
            direction_pdr["距离_m"] == distance, "PDR"
        ].to_numpy()
        jitter = random_generator.uniform(-0.09, 0.09, size=len(values))
        ax.scatter(
            np.full(len(values), x[index]) + jitter,
            values,
            s=14,
            facecolors="white",
            edgecolors=point_gray,
            linewidths=0.65,
            zorder=3,
        )

    ax.errorbar(
        x,
        overall_pdr,
        yerr=pdr_ci,
        fmt="o-",
        color=accent,
        markerfacecolor=accent,
        markeredgecolor="white",
        markeredgewidth=0.6,
        markersize=4.6,
        linewidth=1.25,
        capsize=2.5,
        elinewidth=0.8,
        zorder=4,
    )

    for x_value, pdr in zip(x, overall_pdr):
        ax.text(
            x_value,
            pdr + 0.75,
            f"{pdr:.1f}",
            ha="center",
            va="bottom",
            fontsize=6.2,
        )

    ax.set_xticks(x, [str(int(distance)) for distance in distances])
    ax.set_xlabel("Transmission distance (m)")
    ax.set_ylabel("Packet delivery ratio (%)")
    ax.set_ylim(78, 101.5)
    ax.set_xlim(-0.42, len(distances) - 0.58)
    clean_axes(ax)
    panel_label(ax, "b")


def draw_raincloud_panel(
    ax: plt.Axes,
    distances: np.ndarray,
    groups: list[np.ndarray],
    direction_data: pd.DataFrame,
    value_column: str,
    ylabel: str,
    letter: str,
    ylim: tuple[float, float],
    zero_line: bool = False,
) -> None:
    accent = "#2474B5"
    fill_gray = "#DCE6EC"
    line_gray = "#A6A6A6"

    positions = np.arange(len(distances))

    violin = ax.violinplot(
        groups,
        positions=positions + 0.12,
        widths=0.72,
        showmeans=False,
        showmedians=False,
        showextrema=False,
        bw_method=0.25,
    )

    # Retain only the right half of each violin.
    for body, position in zip(violin["bodies"], positions + 0.12):
        vertices = body.get_paths()[0].vertices
        vertices[:, 0] = np.maximum(vertices[:, 0], position)
        body.set_facecolor(fill_gray)
        body.set_edgecolor(line_gray)
        body.set_linewidth(0.65)
        body.set_alpha(1.0)

    ax.boxplot(
        groups,
        positions=positions - 0.08,
        widths=0.20,
        patch_artist=True,
        showfliers=False,
        medianprops={"color": "#202020", "linewidth": 1.0},
        boxprops={
            "facecolor": "white",
            "edgecolor": "#303030",
            "linewidth": 0.75,
        },
        whiskerprops={"color": "#303030", "linewidth": 0.7},
        capprops={"color": "#303030", "linewidth": 0.7},
    )

    # Overlay the eight direction-level means.
    random_generator = np.random.default_rng(31415)
    for index, distance in enumerate(distances):
        values = direction_data.loc[
            direction_data["距离_m"] == distance, value_column
        ].to_numpy()
        jitter = random_generator.uniform(-0.035, 0.035, size=len(values))
        ax.scatter(
            np.full(len(values), positions[index] + 0.30) + jitter,
            values,
            s=10,
            color=accent,
            alpha=0.82,
            edgecolors="white",
            linewidths=0.3,
            zorder=4,
        )

    if zero_line:
        ax.axhline(
            0,
            color="#555555",
            linewidth=0.65,
            linestyle=(0, (3, 2)),
            zorder=1,
        )

    ax.set_xticks(positions, [str(int(distance)) for distance in distances])
    ax.set_xlabel("Transmission distance (m)")
    ax.set_ylabel(ylabel)
    ax.set_xlim(-0.48, len(distances) - 0.45)
    ax.set_ylim(*ylim)
    clean_axes(ax)
    panel_label(ax, letter)


def create_individual_panels(summary: dict, output_dir: Path) -> None:
    distances = summary["distances"]

    fig, ax = plt.subplots(figsize=(3.35, 2.55))
    draw_pdr_panel(ax, summary)
    fig.tight_layout(pad=0.6)
    save_figure(fig, output_dir, "Fig10b_PDR_NatureStyle")

    fig, ax = plt.subplots(figsize=(3.35, 2.55))
    draw_raincloud_panel(
        ax=ax,
        distances=distances,
        groups=summary["rssi_groups"],
        direction_data=summary["direction_rssi"],
        value_column="RSSI",
        ylabel="RSSI (dBm)",
        letter="c",
        ylim=(-145, -60),
    )
    fig.tight_layout(pad=0.6)
    save_figure(fig, output_dir, "Fig10c_RSSI_NatureStyle")

    fig, ax = plt.subplots(figsize=(3.35, 2.55))
    draw_raincloud_panel(
        ax=ax,
        distances=distances,
        groups=summary["snr_groups"],
        direction_data=summary["direction_snr"],
        value_column="SNR",
        ylabel="SNR (dB)",
        letter="d",
        ylim=(-8, 13),
        zero_line=True,
    )
    fig.tight_layout(pad=0.6)
    save_figure(fig, output_dir, "Fig10d_SNR_NatureStyle")


def create_combined_preview(summary: dict, output_dir: Path) -> None:
    distances = summary["distances"]
    fig, axes = plt.subplots(1, 3, figsize=(7.2, 2.45))

    draw_pdr_panel(axes[0], summary)

    draw_raincloud_panel(
        ax=axes[1],
        distances=distances,
        groups=summary["rssi_groups"],
        direction_data=summary["direction_rssi"],
        value_column="RSSI",
        ylabel="RSSI (dBm)",
        letter="c",
        ylim=(-145, -60),
    )

    draw_raincloud_panel(
        ax=axes[2],
        distances=distances,
        groups=summary["snr_groups"],
        direction_data=summary["direction_snr"],
        value_column="SNR",
        ylabel="SNR (dB)",
        letter="d",
        ylim=(-8, 13),
        zero_line=True,
    )

    fig.subplots_adjust(
        left=0.07,
        right=0.995,
        bottom=0.22,
        top=0.94,
        wspace=0.42,
    )
    save_figure(fig, output_dir, "Fig10bcd_NatureStyle_preview")


def print_summary(summary: dict) -> None:
    table = pd.DataFrame(
        {
            "Distance_m": summary["distances"],
            "PDR_percent": summary["overall_pdr"],
            "RSSI_mean_dBm": [
                np.mean(group) for group in summary["rssi_groups"]
            ],
            "SNR_mean_dB": [
                np.mean(group) for group in summary["snr_groups"]
            ],
        }
    )
    print("\nSummary used for plotting:")
    print(table.to_string(index=False))


def main() -> None:
    args = parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    configure_style()
    data = load_data(args.input)
    summary = calculate_summaries(data)

    create_individual_panels(summary, args.output)
    create_combined_preview(summary, args.output)
    print_summary(summary)

    print(f"\nFigures saved to: {args.output.resolve()}")


if __name__ == "__main__":
    main()
