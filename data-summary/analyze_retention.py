#!/usr/bin/env python3
"""Credit-line-increase experiment: retention summary.

Reads ../data/users.csv and ../data/requests.csv, writes retention_summary.pdf
next to this script.

    data-summary/.venv/bin/python data-summary/analyze_retention.py
"""

from __future__ import annotations

import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import pandas as pd
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.gridspec import GridSpec
from matplotlib.patches import FancyBboxPatch

SNAPSHOT = pd.Timestamp("2026-08-25")
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
USERS_CSV = ROOT / "data" / "users.csv"
REQUESTS_CSV = ROOT / "data" / "requests.csv"
PDF_PATH = HERE / "retention_summary.pdf"

INK = "#14181B"
INK2 = "#5A6467"
INK3 = "#8A9497"
PAPER = "#F6F7F6"
SURFACE = "#FFFFFF"
ACCENT = "#0B5049"
ACCENT_SOFT = "#E0ECE9"
POSITIVE = "#2C6136"
WARNING = "#8A5B06"
CRITICAL = "#8A2E2E"
CRITICAL_SOFT = "#F7E7E5"
RULE = "#E1E6E1"
CONTROL = "#5A6467"
TREATMENT = "#0B5049"

OUTCOME_ORDER = [
    "Control",
    "Treatment · no request",
    "Treatment · approved",
    "Treatment · declined",
]
OUTCOME_LABELS = {
    "Control": "Control",
    "Treatment · no request": "No request",
    "Treatment · approved": "Approved",
    "Treatment · declined": "Declined",
}
OUTCOME_COLORS = [CONTROL, ACCENT_SOFT, POSITIVE, CRITICAL]


def two_prop_p(count_a: int, n_a: int, count_b: int, n_b: int) -> float:
    """Two-sided two-proportion z-test p-value."""
    if min(n_a, n_b) == 0:
        return float("nan")
    p1, p2 = count_a / n_a, count_b / n_b
    p = (count_a + count_b) / (n_a + n_b)
    se = math.sqrt(p * (1 - p) * (1 / n_a + 1 / n_b))
    if se == 0:
        return 1.0
    z = (p1 - p2) / se
    return math.erfc(abs(z) / math.sqrt(2))


def pct(x: float) -> str:
    return f"{100 * x:.1f}%"


def pp(x: float) -> str:
    return f"{100 * x:+.2f} pp"


def load() -> tuple[pd.DataFrame, int]:
    users = pd.read_csv(USERS_CSV, parse_dates=["joined_ts", "account_closed_ts"])
    requests = pd.read_csv(REQUESTS_CSV, parse_dates=["requested_ts"])

    request_dupes = int(requests["user_id"].duplicated().sum())
    if request_dupes:
        requests = (
            requests.sort_values("requested_ts")
            .drop_duplicates("user_id", keep="last")
        )

    df = users.merge(requests, on="user_id", how="left", indicator=True)
    df["requested"] = df["_merge"] == "both"
    df.drop(columns="_merge", inplace=True)

    df["retained"] = df["account_closed_ts"].isna()
    df["closed"] = ~df["retained"]
    df["days_observed"] = (SNAPSHOT - df["joined_ts"]).dt.days
    df["days_to_close"] = (df["account_closed_ts"] - df["joined_ts"]).dt.days
    df["headroom_cents"] = df["max_eligible_limit_cents"] - df["starting_limit_cents"]
    df["zero_headroom"] = df["headroom_cents"] <= 0
    df["asked_above_ceiling"] = df["requested"] & (
        df["requested_limit_cents"] > df["max_eligible_limit_cents"]
    )
    df["join_week"] = df["joined_ts"].dt.to_period("W").dt.start_time

    df["outcome"] = "Treatment · declined"
    df.loc[df["experiment_group"] == "control", "outcome"] = "Control"
    df.loc[(df["experiment_group"] == "treatment") & ~df["requested"], "outcome"] = (
        "Treatment · no request"
    )
    df.loc[df["decision"] == "APPROVED", "outcome"] = "Treatment · approved"
    return df, request_dupes


def closed_in_window(frame: pd.DataFrame, days: int) -> pd.Series:
    eligible = frame.loc[frame["days_observed"] >= days]
    closed = eligible["days_to_close"].le(days).fillna(False)
    return closed


def summarize(df: pd.DataFrame, request_dupes: int) -> dict:
    n = len(df)
    by_group = df.groupby("experiment_group", observed=True)
    counts = by_group.size()
    closed = by_group["closed"].sum()
    closed_rate = by_group["closed"].mean()
    retained_rate = by_group["retained"].mean()

    control_n = int(counts.get("control", 0))
    treatment_n = int(counts.get("treatment", 0))
    control_closed = int(closed.get("control", 0))
    treatment_closed = int(closed.get("treatment", 0))
    control_rate = float(closed_rate.get("control", float("nan")))
    treatment_rate = float(closed_rate.get("treatment", float("nan")))

    treatment = df[df["experiment_group"] == "treatment"]
    control_requests = int(df.loc[df["experiment_group"] == "control", "requested"].sum())

    windows = {}
    for days in (14, 30, 45, 60):
        rows = []
        for group, part in df.groupby("experiment_group"):
            flag = closed_in_window(part, days)
            rows.append(
                {
                    "experiment_group": group,
                    "days": days,
                    "n": int(flag.shape[0]),
                    "rate": float(flag.mean()) if len(flag) else float("nan"),
                }
            )
        windows[days] = pd.DataFrame(rows)

    weekly = (
        df.groupby(["join_week", "experiment_group"], observed=True)
        .agg(n=("user_id", "size"), closed_rate=("closed", "mean"))
        .reset_index()
    )

    outcome = (
        df.groupby("outcome", observed=True)
        .agg(n=("user_id", "size"), closed_rate=("closed", "mean"))
        .reindex(OUTCOME_ORDER)
        .reset_index()
    )

    early_rows = []
    for name in OUTCOME_ORDER:
        flag = closed_in_window(df[df["outcome"] == name], 14)
        early_rows.append(
            {
                "outcome": name,
                "n": int(flag.shape[0]),
                "rate": float(flag.mean()) if len(flag) else float("nan"),
            }
        )
    early = pd.DataFrame(early_rows)

    declined = df[df["decision"] == "DECLINED"].copy()
    reasons = (
        declined.groupby("decline_reason", dropna=False)
        .agg(n=("user_id", "size"), closed_rate=("closed", "mean"))
        .sort_values("n", ascending=False)
        .reset_index()
    )

    return {
        "n": n,
        "request_dupes": request_dupes,
        "control_n": control_n,
        "treatment_n": treatment_n,
        "control_closed": control_closed,
        "treatment_closed": treatment_closed,
        "control_rate": control_rate,
        "treatment_rate": treatment_rate,
        "delta": treatment_rate - control_rate,
        "p_value": two_prop_p(treatment_closed, treatment_n, control_closed, control_n),
        "control_requests": control_requests,
        "request_rate": float(treatment["requested"].mean()),
        "approve_rate_among_requests": float(
            treatment.loc[treatment["requested"], "decision"].eq("APPROVED").mean()
        ),
        "n_requested": int(treatment["requested"].sum()),
        "join_min": df["joined_ts"].min(),
        "join_max": df["joined_ts"].max(),
        "windows": windows,
        "weekly": weekly,
        "outcome": outcome,
        "early": early,
        "reasons": reasons,
        "zero_headroom_share": float(df["zero_headroom"].mean()),
        "treatment_zero_headroom_request_rate": float(
            treatment.loc[treatment["zero_headroom"], "requested"].mean()
        )
        if treatment["zero_headroom"].any()
        else float("nan"),
        "overshoot_share_of_requests": float(
            treatment.loc[treatment["requested"], "asked_above_ceiling"].mean()
        )
        if treatment["requested"].any()
        else float("nan"),
        "overshoot_closed_rate": float(
            treatment.loc[treatment["asked_above_ceiling"], "closed"].mean()
        )
        if treatment["asked_above_ceiling"].any()
        else float("nan"),
        "in_range_request_closed_rate": float(
            treatment.loc[treatment["requested"] & ~treatment["asked_above_ceiling"], "closed"].mean()
        )
        if (treatment["requested"] & ~treatment["asked_above_ceiling"]).any()
        else float("nan"),
    }


def style_fig(fig: plt.Figure) -> None:
    fig.patch.set_facecolor(PAPER)
    for ax in fig.axes:
        ax.set_facecolor(SURFACE)
        ax.tick_params(colors=INK2, labelsize=8)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.spines["left"].set_color(RULE)
        ax.spines["bottom"].set_color(RULE)
        ax.yaxis.label.set_color(INK2)
        ax.xaxis.label.set_color(INK2)
        ax.title.set_color(INK)


def add_footer(fig: plt.Figure, page: str) -> None:
    fig.text(
        0.015,
        0.018,
        "Snapshot 2026-08-25  ·  Closed = account_closed_ts present  ·  "
        "ITT compares randomized assignment, not who requested",
        color=INK3,
        fontsize=7,
        ha="left",
        va="bottom",
    )
    fig.text(0.985, 0.018, page, color=INK3, fontsize=7, ha="right", va="bottom")


def kpi_box(ax, title: str, value: str, subtitle: str, color: str = INK) -> None:
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    ax.add_patch(
        FancyBboxPatch(
            (0.02, 0.08),
            0.96,
            0.84,
            boxstyle="round,pad=0.02,rounding_size=0.04",
            linewidth=1,
            edgecolor=RULE,
            facecolor=SURFACE,
        )
    )
    ax.text(0.07, 0.78, title.upper(), color=INK3, fontsize=7.5, fontweight="bold", va="top")
    ax.text(0.07, 0.48, value, color=color, fontsize=16, fontweight="bold", va="center")
    ax.text(0.07, 0.22, subtitle, color=INK2, fontsize=8, va="center")


def draw_page1(pdf: PdfPages, df: pd.DataFrame, s: dict) -> None:
    fig = plt.figure(figsize=(11, 8.5))
    gs = GridSpec(
        3,
        4,
        figure=fig,
        height_ratios=[0.55, 1.35, 1.25],
        hspace=0.42,
        wspace=0.28,
        left=0.06,
        right=0.97,
        top=0.88,
        bottom=0.08,
    )

    fig.text(0.06, 0.955, "Credit line increase experiment", fontsize=16, fontweight="bold", color=INK)
    direction = "higher" if s["delta"] > 0 else "lower"
    fig.text(
        0.06,
        0.915,
        f"Treatment closed-account rate is {pp(s['delta'])} vs control ({direction} churn). "
        f"ITT p = {s['p_value']:.3g}.",
        fontsize=10,
        color=INK2,
    )

    kpi_box(
        fig.add_subplot(gs[0, 0]),
        "Members",
        f"{s['n']:,}",
        f"{s['control_n']:,} control · {s['treatment_n']:,} treatment",
    )
    kpi_box(
        fig.add_subplot(gs[0, 1]),
        "ITT closed rate",
        f"{pct(s['treatment_rate'])} vs {pct(s['control_rate'])}",
        f"Treatment − control = {pp(s['delta'])}",
        color=CRITICAL if s["delta"] > 0 else POSITIVE,
    )
    kpi_box(
        fig.add_subplot(gs[0, 2]),
        "Treatment request rate",
        pct(s["request_rate"]),
        f"{s['n_requested']:,} of {s['treatment_n']:,} requested once",
        color=ACCENT,
    )
    kpi_box(
        fig.add_subplot(gs[0, 3]),
        "Approval among requests",
        pct(s["approve_rate_among_requests"]),
        f"Control requests: {s['control_requests']:,} (expect 0)",
        color=ACCENT,
    )

    ax = fig.add_subplot(gs[1, :2])
    groups = ["control", "treatment"]
    rates = [s["control_rate"], s["treatment_rate"]]
    ns = [s["control_n"], s["treatment_n"]]
    colors = [CONTROL, TREATMENT]
    bars = ax.bar(groups, [100 * r for r in rates], color=colors, width=0.55)
    ax.set_title("Closed accounts by assignment (ITT)", loc="left", fontsize=11, fontweight="bold")
    ax.set_ylabel("Closed by snapshot (%)")
    ax.set_ylim(0, max(100 * r for r in rates) * 1.35)
    ax.set_xticks([0, 1], ["Control", "Treatment"])
    for bar, rate, n in zip(bars, rates, ns):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + ax.get_ylim()[1] * 0.03,
            f"{pct(rate)}\nn={n:,}",
            ha="center",
            va="bottom",
            fontsize=8,
            color=INK,
        )

    ax = fig.add_subplot(gs[1, 2:])
    days_list = [14, 30, 45, 60]
    for group, color, label in (
        ("control", CONTROL, "Control"),
        ("treatment", TREATMENT, "Treatment"),
    ):
        ys = [100 * float(s["windows"][d].set_index("experiment_group").loc[group, "rate"]) for d in days_list]
        ax.plot(days_list, ys, marker="o", color=color, linewidth=2, label=label)
    ax.set_title("Closed within N days of join (tenure-matched)", loc="left", fontsize=11, fontweight="bold")
    ax.set_xlabel("Days after join")
    ax.set_ylabel("Closed in window (%)")
    ax.set_xticks(days_list)
    ax.legend(frameon=False, fontsize=8)
    ax.set_ylim(bottom=0)

    ax = fig.add_subplot(gs[2, :])
    weekly = s["weekly"]
    for group, color, label in (
        ("control", CONTROL, "Control"),
        ("treatment", TREATMENT, "Treatment"),
    ):
        part = weekly[weekly["experiment_group"] == group].sort_values("join_week")
        ax.plot(part["join_week"], 100 * part["closed_rate"], color=color, linewidth=2, label=label)
    ax.set_title("Closed rate by join week", loc="left", fontsize=11, fontweight="bold")
    ax.set_ylabel("Closed by snapshot (%)")
    ax.legend(frameon=False, fontsize=8)
    fig.autofmt_xdate(rotation=0, ha="center")
    ax.set_ylim(bottom=0)

    style_fig(fig)
    add_footer(fig, "1 / 2")
    pdf.savefig(fig)
    plt.close(fig)


def _labeled_bars(ax, frame: pd.DataFrame, rate_col: str, title: str) -> None:
    labels = frame["outcome"].map(OUTCOME_LABELS)
    bars = ax.barh(labels, 100 * frame[rate_col], color=OUTCOME_COLORS[: len(frame)])
    ax.invert_yaxis()
    ax.set_title(title, loc="left", fontsize=11, fontweight="bold")
    ax.set_xlabel("Closed (%)")
    xmax = max(100 * frame[rate_col].max(), 1) * 1.38
    ax.set_xlim(0, xmax)
    for bar, rate, n in zip(bars, frame[rate_col], frame["n"]):
        ax.text(
            bar.get_width() + xmax * 0.02,
            bar.get_y() + bar.get_height() / 2,
            f"{pct(rate)}  n={int(n):,}",
            va="center",
            fontsize=8,
            color=INK,
        )


def draw_page2(pdf: PdfPages, df: pd.DataFrame, s: dict) -> None:
    fig = plt.figure(figsize=(11, 8.5))
    gs = GridSpec(
        2,
        2,
        figure=fig,
        hspace=0.42,
        wspace=0.32,
        left=0.10,
        right=0.97,
        top=0.86,
        bottom=0.09,
    )

    fig.text(0.06, 0.955, "Where retention moves inside treatment", fontsize=16, fontweight="bold", color=INK)
    fig.text(
        0.06,
        0.915,
        "Requesting is chosen, not randomized. Use this to find the next experiment — not as the ITT result.",
        fontsize=10,
        color=INK2,
    )

    outcome = s["outcome"].dropna(subset=["n"])
    _labeled_bars(
        fig.add_subplot(gs[0, 0]),
        outcome,
        "closed_rate",
        "Closed by snapshot (Approved / Declined are treatment)",
    )

    ax = fig.add_subplot(gs[0, 1])
    reasons = s["reasons"]
    if reasons.empty:
        ax.axis("off")
        ax.text(0.5, 0.5, "No declines in data", ha="center", va="center", color=INK2)
    else:
        labels = reasons["decline_reason"].fillna("(none)").str.replace("_", "\n")
        bars = ax.bar(range(len(reasons)), 100 * reasons["closed_rate"], color=CRITICAL)
        ax.set_xticks(range(len(reasons)), labels, fontsize=7.5)
        ax.set_title("Closed rate by decline reason", loc="left", fontsize=11, fontweight="bold")
        ax.set_ylabel("Closed by snapshot (%)")
        ymax = max(100 * reasons["closed_rate"].max(), 1) * 1.4
        ax.set_ylim(0, ymax)
        for bar, rate, n in zip(bars, reasons["closed_rate"], reasons["n"]):
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                bar.get_height() + ymax * 0.03,
                f"{pct(rate)}\nn={int(n):,}",
                ha="center",
                va="bottom",
                fontsize=7.5,
                color=INK,
            )

    _labeled_bars(
        fig.add_subplot(gs[1, 0]),
        s["early"],
        "rate",
        "Closed within 14 days of join",
    )

    ax = fig.add_subplot(gs[1, 1])
    ax.axis("off")
    lines = [
        "Notes for the ship / no-ship call",
        "",
        f"Join window: {pd.Timestamp(s['join_min']).date()} → {pd.Timestamp(s['join_max']).date()}",
        f"Duplicate request rows: {s['request_dupes']:,}",
        f"Zero headroom at signup: {pct(s['zero_headroom_share'])}",
        f"Zero-headroom treatment still requested at {pct(s['treatment_zero_headroom_request_rate'])}",
        f"Asks above max eligible: {pct(s['overshoot_share_of_requests'])} of requests",
        "Every decline is an overshoot; every approval is in-range.",
        f"Closed if overshoot: {pct(s['overshoot_closed_rate'])}  ·  if in-range: {pct(s['in_range_request_closed_rate'])}",
        "Decline reasons all churn ~32%. The event is the decline,",
        "not which reason code was attached.",
        "",
        "The app slider is USD 100-2,500 and does not cap to remaining room.",
        "The API will accept a doomed ask and return DECLINED.",
    ]
    ax.text(
        0.0,
        1.0,
        "\n".join(lines),
        va="top",
        ha="left",
        fontsize=9,
        color=INK,
        family="sans-serif",
        linespacing=1.45,
    )

    style_fig(fig)
    add_footer(fig, "2 / 2")
    pdf.savefig(fig)
    plt.close(fig)


def print_console(s: dict) -> None:
    print("=== ITT ===")
    print(f"n={s['n']:,}  control={s['control_n']:,}  treatment={s['treatment_n']:,}")
    print(
        f"closed  control={pct(s['control_rate'])}  "
        f"treatment={pct(s['treatment_rate'])}  delta={pp(s['delta'])}  p={s['p_value']:.3g}"
    )
    print(f"treatment request rate={pct(s['request_rate'])}  approve={pct(s['approve_rate_among_requests'])}")
    print(f"control requests={s['control_requests']:,}")
    print()
    print("=== tenure windows (closed within N days | observed ≥ N) ===")
    for days, table in s["windows"].items():
        row = table.set_index("experiment_group")
        c, t = row.loc["control"], row.loc["treatment"]
        print(
            f"  {days:>2}d  control={pct(c['rate'])} (n={int(c['n']):,})  "
            f"treatment={pct(t['rate'])} (n={int(t['n']):,})  "
            f"delta={pp(t['rate'] - c['rate'])}"
        )
    print()
    print("=== outcome paths ===")
    print(s["outcome"].to_string(index=False))
    print()
    print("=== decline reasons ===")
    print(s["reasons"].to_string(index=False))
    print()
    print(f"wrote {PDF_PATH}")


def main() -> None:
    df, request_dupes = load()
    stats = summarize(df, request_dupes)
    with PdfPages(PDF_PATH) as pdf:
        draw_page1(pdf, df, stats)
        draw_page2(pdf, df, stats)
    print_console(stats)


if __name__ == "__main__":
    main()
