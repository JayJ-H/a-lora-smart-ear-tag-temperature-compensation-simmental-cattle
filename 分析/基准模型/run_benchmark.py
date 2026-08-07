from __future__ import annotations

import argparse
import csv
import importlib.metadata as importlib_metadata
import json
import math
import platform
import random
import sys
import time
import warnings
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable, Iterable

import numpy as np
import pandas as pd
from scipy.optimize import differential_evolution
from sklearn.base import BaseEstimator, TransformerMixin, clone
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import (
    AdaBoostRegressor,
    BaggingRegressor,
    ExtraTreesRegressor,
    GradientBoostingRegressor,
    HistGradientBoostingRegressor,
    RandomForestRegressor,
)
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import ConstantKernel, RBF, WhiteKernel
from sklearn.impute import SimpleImputer
from sklearn.kernel_ridge import KernelRidge
from sklearn.linear_model import (
    BayesianRidge,
    ElasticNet,
    HuberRegressor,
    Lasso,
    LinearRegression,
    Ridge,
    SGDRegressor,
)
from sklearn.metrics import r2_score
from sklearn.model_selection import KFold
from sklearn.neighbors import KNeighborsRegressor
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, PolynomialFeatures, SplineTransformer, StandardScaler
from sklearn.svm import LinearSVR, SVR
from sklearn.tree import DecisionTreeRegressor

try:
    from xgboost import XGBRegressor
except Exception:  # pragma: no cover - optional dependency guard
    XGBRegressor = None

try:
    from lightgbm import LGBMRegressor
except Exception:  # pragma: no cover - optional dependency guard
    LGBMRegressor = None


warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=RuntimeWarning)


SHARED_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT = SHARED_ROOT / "数据" / "处理数据" / "th_shrc_oof_predictions.csv"
DEFAULT_REFERENCE = SHARED_ROOT / "数据" / "处理数据" / "model_benchmark_metrics.csv"
DEFAULT_OUTPUT_DIR = SHARED_ROOT / "输出" / "分析" / "基准模型"
PROPOSED_MODEL_NAME = "TH_SHRC"

NUMERIC_COLS = ["Ear", "Air", "Time", "EarMinusAir", "EarAirInteraction", "TimeSin", "TimeCos"]
CATEGORICAL_COLS = ["CowKey", "Source", "SourceType", "EarStatus", "HeatSegment", "SessionID"]
BASE_REQUIRED_COLS = ["RowID", "FoldID", "Actual", "Predicted", "Ear", "Air", "Time", *CATEGORICAL_COLS]

# Preserve category order because seeded estimators bind weights to one-hot positions.
CATEGORY_ORDERS = {
    "CowKey": [
        "C004", "C028", "C008", "C030", "C018", "C025", "C010", "C019",
        "C005", "C021", "C003", "C002", "C029", "C001", "C027", "C026",
        "C016", "C022", "C014", "C023", "C011", "C017", "C020", "C009",
        "C012", "C006", "C015", "C007", "C013", "C024",
    ],
    "Source": ["S03", "S04", "S01"],
    "SourceType": ["reference_stratum_1", "reference_stratum_2"],
    "EarStatus": ["ear_status_1", "ear_status_2"],
    "HeatSegment": ["H04", "H02", "H01", "H03"],
    "SessionID": [
        "SS25", "SS03", "SS52", "SS49", "SS04", "SS02", "SS45", "SS16",
        "SS51", "SS11", "SS12", "SS28", "SS46", "SS27", "SS05", "SS17",
        "SS32", "SS14", "SS30", "SS22", "SS39", "SS07", "SS41", "SS18",
        "SS47", "SS33", "SS01", "SS19", "SS48", "SS42", "SS44", "SS24",
        "SS20", "SS13", "SS34", "SS35", "SS37", "SS21", "SS08", "SS15",
        "SS26", "SS40", "SS10", "SS36", "SS31", "SS38", "SS50", "SS43",
        "SS23", "SS06", "SS29", "SS09",
    ],
}


@dataclass
class ModelSpec:
    model_name: str
    model_family: str
    benchmark_group: str
    feature_set: str
    factory: Callable[[int], Pipeline]
    notes: str


@dataclass
class EvolutionSpec:
    model_name: str
    model_family: str
    benchmark_group: str
    optimizer: str
    search_runner: Callable[[pd.DataFrame, np.ndarray, int], tuple[Pipeline, dict[str, object]]]
    notes: str


def make_one_hot_encoder(categories: list[np.ndarray]) -> OneHotEncoder:
    try:
        return OneHotEncoder(
            categories=categories,
            handle_unknown="ignore",
            sparse_output=False,
        )
    except TypeError:  # pragma: no cover - older sklearn
        return OneHotEncoder(
            categories=categories,
            handle_unknown="ignore",
            sparse=False,
        )


class AnonymousOrderedOneHotEncoder(BaseEstimator, TransformerMixin):
    """Preserve the frozen anonymous order while learning categories per fold."""

    def __init__(self, categorical_cols: tuple[str, ...]):
        self.categorical_cols = categorical_cols

    def fit(self, X, y=None):
        values = np.asarray(X, dtype=object)
        categories: list[np.ndarray] = []
        for index, col in enumerate(self.categorical_cols):
            observed = set(values[:, index].astype(str))
            declared = CATEGORY_ORDERS[col]
            unexpected = observed - set(declared)
            if unexpected:
                raise ValueError(f"Unexpected {col} categories: {sorted(unexpected)}")
            categories.append(
                np.asarray([value for value in declared if value in observed], dtype=object)
            )
        self.encoder_ = make_one_hot_encoder(categories)
        self.encoder_.fit(values)
        return self

    def transform(self, X):
        return self.encoder_.transform(np.asarray(X, dtype=object))

    def get_feature_names_out(self, input_features=None):
        return self.encoder_.get_feature_names_out(input_features)


def one_hot_encoder(categorical_cols: Iterable[str]) -> AnonymousOrderedOneHotEncoder:
    return AnonymousOrderedOneHotEncoder(tuple(categorical_cols))


def add_engineered_features(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["EarMinusAir"] = out["Ear"] - out["Air"]
    out["EarAirInteraction"] = out["Ear"] * out["Air"]
    out["TimeSin"] = np.sin(2.0 * np.pi * out["Time"].astype(float) / 24.0)
    out["TimeCos"] = np.cos(2.0 * np.pi * out["Time"].astype(float) / 24.0)
    for col in CATEGORICAL_COLS:
        out[col] = out[col].astype(str).fillna("missing")
    return out


def load_data(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    missing = [col for col in BASE_REQUIRED_COLS if col not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns in {path}: {missing}")
    if df["RowID"].duplicated().any():
        raise ValueError("RowID must be unique.")
    if "CowID_raw" in df.columns:
        raise ValueError("Public benchmark input must not contain CowID_raw.")
    if len(df) != 503 or df["CowKey"].nunique() != 30:
        raise ValueError("Expected 503 rows and 30 anonymous CowKey values.")
    if set(df["FoldID"].astype(int)) != {1, 2, 3, 4, 5}:
        raise ValueError("FoldID must contain exactly 1, 2, 3, 4, and 5.")
    for col, declared_order in CATEGORY_ORDERS.items():
        observed = set(df[col].dropna().astype(str))
        declared = set(declared_order)
        if observed != declared:
            raise ValueError(
                f"{col} categories do not match the frozen anonymous schema: "
                f"missing={sorted(declared - observed)}, unexpected={sorted(observed - declared)}"
            )
    return add_engineered_features(df)


def default_preprocessor(
    numeric_cols: Iterable[str] = NUMERIC_COLS,
    categorical_cols: Iterable[str] = CATEGORICAL_COLS,
    scale_numeric: bool = True,
) -> ColumnTransformer:
    categorical_cols = list(categorical_cols)
    if scale_numeric:
        numeric = Pipeline([("imputer", SimpleImputer(strategy="median")), ("scaler", StandardScaler())])
    else:
        numeric = Pipeline([("imputer", SimpleImputer(strategy="median"))])
    categorical = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("onehot", one_hot_encoder(categorical_cols)),
        ]
    )
    return ColumnTransformer(
        transformers=[
            ("num", numeric, list(numeric_cols)),
            ("cat", categorical, categorical_cols),
        ],
        remainder="drop",
        verbose_feature_names_out=False,
    )


def numeric_only_preprocessor(numeric_cols: Iterable[str], scale_numeric: bool = True) -> ColumnTransformer:
    if scale_numeric:
        numeric = Pipeline([("imputer", SimpleImputer(strategy="median")), ("scaler", StandardScaler())])
    else:
        numeric = Pipeline([("imputer", SimpleImputer(strategy="median"))])
    return ColumnTransformer(
        transformers=[("num", numeric, list(numeric_cols))],
        remainder="drop",
        verbose_feature_names_out=False,
    )


def spline_preprocessor() -> ColumnTransformer:
    numeric = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="median")),
            ("spline", SplineTransformer(n_knots=5, degree=3, include_bias=False)),
            ("scaler", StandardScaler()),
        ]
    )
    categorical = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("onehot", one_hot_encoder(CATEGORICAL_COLS)),
        ]
    )
    return ColumnTransformer(
        transformers=[
            ("num_spline", numeric, NUMERIC_COLS),
            ("cat", categorical, CATEGORICAL_COLS),
        ],
        remainder="drop",
        verbose_feature_names_out=False,
    )


def polynomial_preprocessor() -> ColumnTransformer:
    numeric = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="median")),
            ("poly", PolynomialFeatures(degree=2, include_bias=False)),
            ("scaler", StandardScaler()),
        ]
    )
    categorical = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("onehot", one_hot_encoder(CATEGORICAL_COLS)),
        ]
    )
    return ColumnTransformer(
        transformers=[
            ("num_poly", numeric, NUMERIC_COLS),
            ("cat", categorical, CATEGORICAL_COLS),
        ],
        remainder="drop",
        verbose_feature_names_out=False,
    )


def build_pipeline(estimator, *, tree_like: bool = False, numeric_cols=None, categorical_cols=None) -> Pipeline:
    numeric_cols = NUMERIC_COLS if numeric_cols is None else numeric_cols
    categorical_cols = CATEGORICAL_COLS if categorical_cols is None else categorical_cols
    return Pipeline(
        [
            ("preprocess", default_preprocessor(numeric_cols, categorical_cols, scale_numeric=not tree_like)),
            ("model", estimator),
        ]
    )


def make_bagging_regressor(seed: int):
    base = DecisionTreeRegressor(random_state=seed, min_samples_leaf=2)
    try:
        return BaggingRegressor(estimator=base, n_estimators=120, random_state=seed, n_jobs=1)
    except TypeError:  # pragma: no cover - older sklearn
        return BaggingRegressor(base_estimator=base, n_estimators=120, random_state=seed, n_jobs=1)


def conventional_model_specs() -> list[ModelSpec]:
    specs = [
        ModelSpec(
            "MeanTrain",
            "constant baseline",
            "linear_baseline",
            "no_features",
            lambda seed: Pipeline([("model", DummyRegressor(strategy="mean"))]),
            "Training-fold mean body temperature.",
        ),
        ModelSpec(
            "EarOnlyLinear",
            "linear",
            "linear_baseline",
            "ear_only",
            lambda seed: Pipeline(
                [("preprocess", numeric_only_preprocessor(["Ear"])), ("model", LinearRegression())]
            ),
            "Single ear-surface temperature linear regression.",
        ),
        ModelSpec(
            "MultipleLinear",
            "linear",
            "linear_baseline",
            "raw_engineered_context",
            lambda seed: build_pipeline(LinearRegression()),
            "Ordinary least squares using numeric and context features.",
        ),
        ModelSpec(
            "Ridge",
            "regularized linear",
            "linear_baseline",
            "raw_engineered_context",
            lambda seed: build_pipeline(Ridge(alpha=1.0, random_state=seed)),
            "L2-regularized linear model.",
        ),
        ModelSpec(
            "Lasso",
            "regularized linear",
            "linear_baseline",
            "raw_engineered_context",
            lambda seed: build_pipeline(Lasso(alpha=0.001, max_iter=10000, random_state=seed)),
            "L1-regularized linear model.",
        ),
        ModelSpec(
            "ElasticNet",
            "regularized linear",
            "linear_baseline",
            "raw_engineered_context",
            lambda seed: build_pipeline(
                ElasticNet(alpha=0.001, l1_ratio=0.3, max_iter=10000, random_state=seed)
            ),
            "L1/L2 regularized linear model.",
        ),
        ModelSpec(
            "BayesianRidge",
            "regularized linear",
            "linear_baseline",
            "raw_engineered_context",
            lambda seed: build_pipeline(BayesianRidge()),
            "Bayesian regularized linear regression.",
        ),
        ModelSpec(
            "HuberRegressor",
            "robust linear",
            "linear_baseline",
            "raw_engineered_context",
            lambda seed: build_pipeline(HuberRegressor(max_iter=1000, epsilon=1.35)),
            "Robust linear regression.",
        ),
        ModelSpec(
            "PolynomialRidge",
            "nonlinear linear-basis",
            "linear_baseline",
            "polynomial_numeric_context",
            lambda seed: Pipeline([("preprocess", polynomial_preprocessor()), ("model", Ridge(alpha=1.0))]),
            "Degree-2 numeric polynomial basis plus context one-hot features.",
        ),
        ModelSpec(
            "SplineRidge_GAMLike",
            "GAM-like spline",
            "linear_baseline",
            "spline_numeric_context",
            lambda seed: Pipeline([("preprocess", spline_preprocessor()), ("model", Ridge(alpha=1.0))]),
            "Spline additive approximation with ridge regularization.",
        ),
        ModelSpec(
            "SGD_Huber",
            "linear online",
            "linear_baseline",
            "raw_engineered_context",
            lambda seed: build_pipeline(
                SGDRegressor(
                    loss="huber",
                    penalty="elasticnet",
                    alpha=0.0005,
                    l1_ratio=0.15,
                    max_iter=5000,
                    tol=1e-4,
                    random_state=seed,
                )
            ),
            "Elastic-net online linear robust regressor.",
        ),
        ModelSpec(
            "KNN_k5",
            "nearest neighbor",
            "conventional_ml",
            "raw_engineered_context",
            lambda seed: build_pipeline(KNeighborsRegressor(n_neighbors=5, weights="distance", p=2)),
            "Distance-weighted k-nearest neighbors.",
        ),
        ModelSpec(
            "SVR_RBF",
            "kernel method",
            "conventional_ml",
            "raw_engineered_context",
            lambda seed: build_pipeline(SVR(kernel="rbf", C=10.0, gamma="scale", epsilon=0.05)),
            "Support vector regression with RBF kernel.",
        ),
        ModelSpec(
            "LinearSVR",
            "kernel/linear margin",
            "conventional_ml",
            "raw_engineered_context",
            lambda seed: build_pipeline(LinearSVR(C=1.0, epsilon=0.05, random_state=seed, max_iter=10000)),
            "Linear support vector regression.",
        ),
        ModelSpec(
            "KernelRidge_RBF",
            "kernel method",
            "conventional_ml",
            "raw_engineered_context",
            lambda seed: build_pipeline(KernelRidge(alpha=1.0, kernel="rbf", gamma=0.05)),
            "Kernel ridge regression with RBF kernel.",
        ),
        ModelSpec(
            "DecisionTree",
            "tree",
            "conventional_ml",
            "raw_engineered_context",
            lambda seed: build_pipeline(
                DecisionTreeRegressor(max_depth=6, min_samples_leaf=4, random_state=seed), tree_like=True
            ),
            "Single regression tree.",
        ),
        ModelSpec(
            "RandomForest",
            "bagging ensemble",
            "conventional_ml",
            "raw_engineered_context",
            lambda seed: build_pipeline(
                RandomForestRegressor(
                    n_estimators=240,
                    max_depth=None,
                    min_samples_leaf=2,
                    max_features=0.8,
                    random_state=seed,
                    n_jobs=1,
                ),
                tree_like=True,
            ),
            "Random forest.",
        ),
        ModelSpec(
            "ExtraTrees",
            "bagging ensemble",
            "conventional_ml",
            "raw_engineered_context",
            lambda seed: build_pipeline(
                ExtraTreesRegressor(
                    n_estimators=240,
                    max_depth=None,
                    min_samples_leaf=2,
                    max_features=0.8,
                    random_state=seed,
                    n_jobs=1,
                ),
                tree_like=True,
            ),
            "Extremely randomized trees.",
        ),
        ModelSpec(
            "BaggedTree",
            "bagging ensemble",
            "conventional_ml",
            "raw_engineered_context",
            lambda seed: build_pipeline(make_bagging_regressor(seed), tree_like=True),
            "Bagged regression trees.",
        ),
        ModelSpec(
            "AdaBoostTree",
            "boosting ensemble",
            "conventional_ml",
            "raw_engineered_context",
            lambda seed: build_pipeline(
                AdaBoostRegressor(
                    estimator=DecisionTreeRegressor(max_depth=3, min_samples_leaf=4, random_state=seed),
                    n_estimators=120,
                    learning_rate=0.03,
                    random_state=seed,
                ),
                tree_like=True,
            ),
            "AdaBoost over shallow regression trees.",
        ),
        ModelSpec(
            "GradientBoosting",
            "boosting ensemble",
            "conventional_ml",
            "raw_engineered_context",
            lambda seed: build_pipeline(
                GradientBoostingRegressor(
                    n_estimators=180,
                    learning_rate=0.04,
                    max_depth=2,
                    min_samples_leaf=4,
                    subsample=0.85,
                    random_state=seed,
                ),
                tree_like=True,
            ),
            "Gradient boosting regression trees.",
        ),
        ModelSpec(
            "HistGradientBoosting",
            "boosting ensemble",
            "conventional_ml",
            "raw_engineered_context",
            lambda seed: build_pipeline(
                HistGradientBoostingRegressor(
                    max_iter=180,
                    learning_rate=0.04,
                    max_leaf_nodes=15,
                    l2_regularization=0.01,
                    random_state=seed,
                ),
                tree_like=True,
            ),
            "Histogram gradient boosting.",
        ),
        ModelSpec(
            "MLP",
            "neural network",
            "conventional_ml",
            "raw_engineered_context",
            lambda seed: build_pipeline(
                MLPRegressor(
                    hidden_layer_sizes=(48, 24),
                    activation="relu",
                    alpha=0.01,
                    learning_rate_init=0.003,
                    max_iter=2000,
                    early_stopping=True,
                    validation_fraction=0.15,
                    random_state=seed,
                )
            ),
            "Feed-forward neural network.",
        ),
        ModelSpec(
            "GaussianProcess_RBF",
            "Gaussian process",
            "conventional_ml",
            "raw_engineered_context",
            lambda seed: build_pipeline(
                GaussianProcessRegressor(
                    kernel=ConstantKernel(1.0) * RBF(length_scale=1.0) + WhiteKernel(noise_level=0.1),
                    alpha=1e-5,
                    normalize_y=True,
                    random_state=seed,
                    optimizer=None,
                )
            ),
            "RBF Gaussian process without hyperparameter optimization.",
        ),
    ]
    if XGBRegressor is not None:
        specs.append(
            ModelSpec(
                "XGBoost",
                "boosting ensemble",
                "conventional_ml",
                "raw_engineered_context",
                lambda seed: build_pipeline(
                    XGBRegressor(
                        n_estimators=220,
                        max_depth=3,
                        learning_rate=0.04,
                        subsample=0.85,
                        colsample_bytree=0.85,
                        reg_lambda=1.0,
                        objective="reg:squarederror",
                        random_state=seed,
                        n_jobs=1,
                        verbosity=0,
                    ),
                    tree_like=True,
                ),
                "XGBoost gradient boosting.",
            )
        )
    if LGBMRegressor is not None:
        specs.append(
            ModelSpec(
                "LightGBM",
                "boosting ensemble",
                "conventional_ml",
                "raw_engineered_context",
                lambda seed: build_pipeline(
                    LGBMRegressor(
                        n_estimators=220,
                        learning_rate=0.04,
                        num_leaves=15,
                        min_child_samples=8,
                        subsample=0.85,
                        colsample_bytree=0.85,
                        reg_lambda=1.0,
                        random_state=seed,
                        n_jobs=1,
                        verbosity=-1,
                        force_col_wise=True,
                    ),
                    tree_like=True,
                ),
                "LightGBM gradient boosting.",
            )
        )
    return specs


def rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.sqrt(np.mean((y_true - y_pred) ** 2)))


def metric_dict(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, float]:
    resid = y_true - y_pred
    abs_err = np.abs(resid)
    return {
        "N": int(len(y_true)),
        "R2": float(r2_score(y_true, y_pred)),
        "RMSE": rmse(y_true, y_pred),
        "MAE": float(np.mean(abs_err)),
        "Bias_actual_minus_pred": float(np.mean(resid)),
        "ErrorSD": float(np.std(resid, ddof=1)) if len(resid) > 1 else 0.0,
        "MedianAE": float(np.median(abs_err)),
        "P75_AE": float(np.quantile(abs_err, 0.75)),
        "P90_AE": float(np.quantile(abs_err, 0.90)),
        "P95_AE": float(np.quantile(abs_err, 0.95)),
        "MaxAE": float(np.max(abs_err)),
        "Within_0_1C": float(np.mean(abs_err <= 0.1)),
        "Within_0_2C": float(np.mean(abs_err <= 0.2)),
        "Within_0_3C": float(np.mean(abs_err <= 0.3)),
        "Within_0_5C": float(np.mean(abs_err <= 0.5)),
    }


def fold_metric_rows(
    model_name: str,
    model_family: str,
    benchmark_group: str,
    predictions: pd.DataFrame,
    elapsed_seconds: float,
    notes: str,
) -> list[dict[str, object]]:
    rows = []
    for fold_id, fold_df in predictions.groupby("FoldID", sort=True):
        metrics = metric_dict(fold_df["Actual"].to_numpy(float), fold_df["Predicted"].to_numpy(float))
        rows.append(
            {
                "Model": model_name,
                "ModelFamily": model_family,
                "BenchmarkGroup": benchmark_group,
                "FoldID": int(fold_id),
                "ElapsedSecondsTotal": elapsed_seconds,
                "Notes": notes,
                **metrics,
            }
        )
    return rows


def summary_row(
    model_name: str,
    model_family: str,
    benchmark_group: str,
    feature_set: str,
    predictions: pd.DataFrame,
    elapsed_seconds: float,
    notes: str,
) -> dict[str, object]:
    metrics = metric_dict(predictions["Actual"].to_numpy(float), predictions["Predicted"].to_numpy(float))
    return {
        "Model": model_name,
        "ModelFamily": model_family,
        "BenchmarkGroup": benchmark_group,
        "FeatureSet": feature_set,
        "FoldMode": "within_cow_random5_from_StrictThreeModelStack_predictions",
        "FoldCount": int(predictions["FoldID"].nunique()),
        "CowCount": int(predictions["CowKey"].nunique()),
        "SourceCount": int(predictions["Source"].nunique()),
        "ElapsedSecondsTotal": elapsed_seconds,
        "Notes": notes,
        **metrics,
    }


def prediction_rows_for_reference(df: pd.DataFrame) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "Model": PROPOSED_MODEL_NAME,
            "ModelFamily": "stacked compensation",
            "BenchmarkGroup": "proposed_model_reference",
            "FeatureSet": "three_component_oof_predictions_plus_fold_specific_ridge_stack",
            "RowID": df["RowID"].astype(int),
            "FoldID": df["FoldID"].astype(int),
            "CowKey": df["CowKey"].astype(str),
            "Source": df["Source"].astype(str),
            "Actual": df["Actual"].astype(float),
            "Predicted": df["Predicted"].astype(float),
        }
    )


def run_oof_model(df: pd.DataFrame, spec: ModelSpec, seed: int) -> tuple[pd.DataFrame, float, str]:
    if spec.model_name == "MeanTrain":
        feature_df = pd.DataFrame({"constant": np.ones(len(df))})
    else:
        feature_df = df
    y = df["Actual"].to_numpy(float)
    all_parts = []
    start = time.perf_counter()
    for fold_id in sorted(df["FoldID"].unique()):
        train_idx = df["FoldID"].to_numpy() != fold_id
        test_idx = ~train_idx
        model = spec.factory(seed + int(fold_id))
        model.fit(feature_df.loc[train_idx], y[train_idx])
        pred = np.asarray(model.predict(feature_df.loc[test_idx]), dtype=float)
        part = pd.DataFrame(
            {
                "Model": spec.model_name,
                "ModelFamily": spec.model_family,
                "BenchmarkGroup": spec.benchmark_group,
                "FeatureSet": spec.feature_set,
                "RowID": df.loc[test_idx, "RowID"].astype(int).to_numpy(),
                "FoldID": df.loc[test_idx, "FoldID"].astype(int).to_numpy(),
                "CowKey": df.loc[test_idx, "CowKey"].astype(str).to_numpy(),
                "Source": df.loc[test_idx, "Source"].astype(str).to_numpy(),
                "Actual": y[test_idx],
                "Predicted": pred,
            }
        )
        all_parts.append(part)
    elapsed = time.perf_counter() - start
    return pd.concat(all_parts, ignore_index=True), elapsed, ""


def inner_cv_rmse(
    x_train: pd.DataFrame,
    y_train: np.ndarray,
    factory: Callable[[dict[str, object], int], Pipeline],
    params: dict[str, object],
    seed: int,
) -> float:
    kfold = KFold(n_splits=3, shuffle=True, random_state=seed)
    scores = []
    for inner_id, (fit_idx, val_idx) in enumerate(kfold.split(x_train), start=1):
        model = factory(params, seed + inner_id)
        model.fit(x_train.iloc[fit_idx], y_train[fit_idx])
        pred = np.asarray(model.predict(x_train.iloc[val_idx]), dtype=float)
        scores.append(rmse(y_train[val_idx], pred))
    return float(np.mean(scores))


def cached_objective(
    x_train: pd.DataFrame,
    y_train: np.ndarray,
    factory: Callable[[dict[str, object], int], Pipeline],
    decoder: Callable[[Iterable[float]], dict[str, object]],
    seed: int,
) -> Callable[[Iterable[float]], float]:
    cache: dict[str, float] = {}

    def objective(position: Iterable[float]) -> float:
        params = decoder(position)
        key = json.dumps(params, sort_keys=True)
        if key not in cache:
            cache[key] = inner_cv_rmse(x_train, y_train, factory, params, seed)
        return cache[key]

    objective.cache = cache  # type: ignore[attr-defined]
    return objective


def clip_position(position: np.ndarray, bounds: list[tuple[float, float]]) -> np.ndarray:
    out = np.array(position, dtype=float)
    for i, (lo, hi) in enumerate(bounds):
        out[i] = min(max(out[i], lo), hi)
    return out


def ga_search(
    x_train: pd.DataFrame,
    y_train: np.ndarray,
    factory: Callable[[dict[str, object], int], Pipeline],
    decoder: Callable[[Iterable[float]], dict[str, object]],
    bounds: list[tuple[float, float]],
    seed: int,
    population_size: int = 7,
    generations: int = 5,
) -> tuple[dict[str, object], dict[str, object]]:
    rng = np.random.default_rng(seed)
    objective = cached_objective(x_train, y_train, factory, decoder, seed)
    population = np.array(
        [[rng.uniform(lo, hi) for lo, hi in bounds] for _ in range(population_size)],
        dtype=float,
    )
    scores = np.array([objective(ind) for ind in population])
    for _ in range(generations):
        order = np.argsort(scores)
        elites = population[order[:2]].copy()
        children = [elites[0], elites[1]]
        while len(children) < population_size:
            p1, p2 = population[rng.choice(order[: max(3, population_size // 2)], size=2, replace=True)]
            alpha = rng.uniform(0.25, 0.75)
            child = alpha * p1 + (1.0 - alpha) * p2
            mutation = rng.normal(0, 0.15, size=len(bounds)) * np.array([hi - lo for lo, hi in bounds])
            child = clip_position(child + mutation, bounds)
            children.append(child)
        population = np.array(children)
        scores = np.array([objective(ind) for ind in population])
    best = population[int(np.argmin(scores))]
    params = decoder(best)
    meta = {"optimizer": "genetic_algorithm", "inner_cv_rmse": float(min(scores)), "evaluations": len(objective.cache)}
    return params, meta


def pso_search(
    x_train: pd.DataFrame,
    y_train: np.ndarray,
    factory: Callable[[dict[str, object], int], Pipeline],
    decoder: Callable[[Iterable[float]], dict[str, object]],
    bounds: list[tuple[float, float]],
    seed: int,
    particles: int = 6,
    iterations: int = 5,
) -> tuple[dict[str, object], dict[str, object]]:
    rng = np.random.default_rng(seed)
    objective = cached_objective(x_train, y_train, factory, decoder, seed)
    lows = np.array([lo for lo, _ in bounds], dtype=float)
    highs = np.array([hi for _, hi in bounds], dtype=float)
    positions = rng.uniform(lows, highs, size=(particles, len(bounds)))
    velocities = rng.normal(0, 0.1, size=(particles, len(bounds))) * (highs - lows)
    personal_best = positions.copy()
    personal_scores = np.array([objective(pos) for pos in positions])
    global_best = personal_best[int(np.argmin(personal_scores))].copy()
    global_score = float(np.min(personal_scores))
    for _ in range(iterations):
        for i in range(particles):
            r1 = rng.random(len(bounds))
            r2 = rng.random(len(bounds))
            velocities[i] = 0.55 * velocities[i] + 1.2 * r1 * (personal_best[i] - positions[i]) + 1.2 * r2 * (
                global_best - positions[i]
            )
            positions[i] = clip_position(positions[i] + velocities[i], bounds)
            score = objective(positions[i])
            if score < personal_scores[i]:
                personal_scores[i] = score
                personal_best[i] = positions[i].copy()
                if score < global_score:
                    global_score = score
                    global_best = positions[i].copy()
    params = decoder(global_best)
    meta = {"optimizer": "particle_swarm_optimization", "inner_cv_rmse": global_score, "evaluations": len(objective.cache)}
    return params, meta


def sa_search(
    x_train: pd.DataFrame,
    y_train: np.ndarray,
    factory: Callable[[dict[str, object], int], Pipeline],
    decoder: Callable[[Iterable[float]], dict[str, object]],
    bounds: list[tuple[float, float]],
    seed: int,
    iterations: int = 30,
) -> tuple[dict[str, object], dict[str, object]]:
    rng = np.random.default_rng(seed)
    objective = cached_objective(x_train, y_train, factory, decoder, seed)
    lows = np.array([lo for lo, _ in bounds], dtype=float)
    highs = np.array([hi for _, hi in bounds], dtype=float)
    current = rng.uniform(lows, highs)
    current_score = objective(current)
    best = current.copy()
    best_score = current_score
    temperature = 1.0
    for _ in range(iterations):
        proposal = current + rng.normal(0, 0.18, size=len(bounds)) * (highs - lows)
        proposal = clip_position(proposal, bounds)
        score = objective(proposal)
        accept = score < current_score or rng.random() < math.exp(-(score - current_score) / max(temperature, 1e-6))
        if accept:
            current = proposal
            current_score = score
        if score < best_score:
            best = proposal.copy()
            best_score = score
        temperature *= 0.88
    params = decoder(best)
    meta = {"optimizer": "simulated_annealing", "inner_cv_rmse": float(best_score), "evaluations": len(objective.cache)}
    return params, meta


def gwo_search(
    x_train: pd.DataFrame,
    y_train: np.ndarray,
    factory: Callable[[dict[str, object], int], Pipeline],
    decoder: Callable[[Iterable[float]], dict[str, object]],
    bounds: list[tuple[float, float]],
    seed: int,
    wolves: int = 6,
    iterations: int = 5,
) -> tuple[dict[str, object], dict[str, object]]:
    rng = np.random.default_rng(seed)
    objective = cached_objective(x_train, y_train, factory, decoder, seed)
    lows = np.array([lo for lo, _ in bounds], dtype=float)
    highs = np.array([hi for _, hi in bounds], dtype=float)
    positions = rng.uniform(lows, highs, size=(wolves, len(bounds)))
    scores = np.array([objective(pos) for pos in positions])
    for iteration in range(iterations):
        order = np.argsort(scores)
        alpha, beta, delta = positions[order[0]], positions[order[1]], positions[order[2]]
        a = 2.0 - 2.0 * (iteration / max(iterations - 1, 1))
        new_positions = []
        for pos in positions:
            candidates = []
            for leader in (alpha, beta, delta):
                r1 = rng.random(len(bounds))
                r2 = rng.random(len(bounds))
                avec = 2.0 * a * r1 - a
                cvec = 2.0 * r2
                candidates.append(leader - avec * np.abs(cvec * leader - pos))
            new_positions.append(clip_position(np.mean(candidates, axis=0), bounds))
        positions = np.array(new_positions)
        scores = np.array([objective(pos) for pos in positions])
    best = positions[int(np.argmin(scores))]
    params = decoder(best)
    meta = {"optimizer": "grey_wolf_optimizer", "inner_cv_rmse": float(np.min(scores)), "evaluations": len(objective.cache)}
    return params, meta


def decode_svr(pos: Iterable[float]) -> dict[str, object]:
    c_log, gamma_log, epsilon = list(pos)
    return {"C": round(10**c_log, 6), "gamma": round(10**gamma_log, 8), "epsilon": round(epsilon, 4)}


def factory_svr(params: dict[str, object], seed: int) -> Pipeline:
    return build_pipeline(
        SVR(kernel="rbf", C=float(params["C"]), gamma=float(params["gamma"]), epsilon=float(params["epsilon"]))
    )


def decode_rf(pos: Iterable[float]) -> dict[str, object]:
    n_estimators, max_depth, min_leaf, max_features = list(pos)
    return {
        "n_estimators": int(round(n_estimators / 10.0) * 10),
        "max_depth": int(round(max_depth)),
        "min_samples_leaf": int(round(min_leaf)),
        "max_features": round(float(max_features), 3),
    }


def factory_rf(params: dict[str, object], seed: int) -> Pipeline:
    return build_pipeline(
        RandomForestRegressor(
            n_estimators=int(params["n_estimators"]),
            max_depth=int(params["max_depth"]),
            min_samples_leaf=int(params["min_samples_leaf"]),
            max_features=float(params["max_features"]),
            random_state=seed,
            n_jobs=1,
        ),
        tree_like=True,
    )


def decode_gbm(pos: Iterable[float]) -> dict[str, object]:
    n_estimators, learning_log, max_depth, min_leaf, subsample = list(pos)
    return {
        "n_estimators": int(round(n_estimators / 10.0) * 10),
        "learning_rate": round(10**learning_log, 6),
        "max_depth": int(round(max_depth)),
        "min_samples_leaf": int(round(min_leaf)),
        "subsample": round(float(subsample), 3),
    }


def factory_gbm(params: dict[str, object], seed: int) -> Pipeline:
    return build_pipeline(
        GradientBoostingRegressor(
            n_estimators=int(params["n_estimators"]),
            learning_rate=float(params["learning_rate"]),
            max_depth=int(params["max_depth"]),
            min_samples_leaf=int(params["min_samples_leaf"]),
            subsample=float(params["subsample"]),
            random_state=seed,
        ),
        tree_like=True,
    )


def decode_knn(pos: Iterable[float]) -> dict[str, object]:
    n_neighbors, p_value, weights_flag = list(pos)
    return {
        "n_neighbors": int(round(n_neighbors)),
        "p": int(round(p_value)),
        "weights": "distance" if weights_flag >= 0.5 else "uniform",
    }


def factory_knn(params: dict[str, object], seed: int) -> Pipeline:
    return build_pipeline(
        KNeighborsRegressor(
            n_neighbors=int(params["n_neighbors"]),
            p=int(params["p"]),
            weights=str(params["weights"]),
        )
    )


def decode_extratrees(pos: Iterable[float]) -> dict[str, object]:
    n_estimators, max_depth, min_leaf, max_features = list(pos)
    return {
        "n_estimators": int(round(n_estimators / 10.0) * 10),
        "max_depth": int(round(max_depth)),
        "min_samples_leaf": int(round(min_leaf)),
        "max_features": round(float(max_features), 3),
    }


def factory_extratrees(params: dict[str, object], seed: int) -> Pipeline:
    return build_pipeline(
        ExtraTreesRegressor(
            n_estimators=int(params["n_estimators"]),
            max_depth=int(params["max_depth"]),
            min_samples_leaf=int(params["min_samples_leaf"]),
            max_features=float(params["max_features"]),
            random_state=seed,
            n_jobs=1,
        ),
        tree_like=True,
    )


def decode_xgb(pos: Iterable[float]) -> dict[str, object]:
    n_estimators, learning_log, max_depth, subsample, colsample, reg_lambda = list(pos)
    return {
        "n_estimators": int(round(n_estimators / 10.0) * 10),
        "learning_rate": round(10**learning_log, 6),
        "max_depth": int(round(max_depth)),
        "subsample": round(float(subsample), 3),
        "colsample_bytree": round(float(colsample), 3),
        "reg_lambda": round(float(reg_lambda), 3),
    }


def factory_xgb(params: dict[str, object], seed: int) -> Pipeline:
    if XGBRegressor is None:
        raise RuntimeError("xgboost is not available")
    return build_pipeline(
        XGBRegressor(
            n_estimators=int(params["n_estimators"]),
            learning_rate=float(params["learning_rate"]),
            max_depth=int(params["max_depth"]),
            subsample=float(params["subsample"]),
            colsample_bytree=float(params["colsample_bytree"]),
            reg_lambda=float(params["reg_lambda"]),
            objective="reg:squarederror",
            random_state=seed,
            n_jobs=1,
            verbosity=0,
        ),
        tree_like=True,
    )


def make_evolution_specs() -> list[EvolutionSpec]:
    specs = [
        EvolutionSpec(
            "GA_SVR_RBF",
            "kernel method",
            "evolutionary_optimized_ml",
            "genetic_algorithm",
            lambda x, y, seed: build_evolution_model(
                x,
                y,
                seed,
                factory_svr,
                decode_svr,
                [(-1.0, 2.0), (-3.0, 0.0), (0.01, 0.25)],
                lambda *args: ga_search(*args, population_size=7, generations=5),
            ),
            "Genetic algorithm tunes C, gamma, and epsilon for RBF-SVR.",
        ),
        EvolutionSpec(
            "PSO_RandomForest",
            "bagging ensemble",
            "evolutionary_optimized_ml",
            "particle_swarm_optimization",
            lambda x, y, seed: build_evolution_model(
                x,
                y,
                seed,
                factory_rf,
                decode_rf,
                [(60, 220), (2, 16), (1, 8), (0.35, 1.0)],
                lambda *args: pso_search(*args, particles=6, iterations=5),
            ),
            "Particle swarm optimization tunes random-forest depth, leaf size, trees, and feature fraction.",
        ),
        EvolutionSpec(
            "DE_GradientBoosting",
            "boosting ensemble",
            "evolutionary_optimized_ml",
            "differential_evolution",
            lambda x, y, seed: build_de_model(
                x,
                y,
                seed,
                factory_gbm,
                decode_gbm,
                [(50, 240), (-2.0, -0.7), (1, 4), (1, 10), (0.55, 1.0)],
                maxiter=3,
                popsize=3,
            ),
            "Differential evolution tunes gradient-boosting tree parameters.",
        ),
        EvolutionSpec(
            "SA_KNN",
            "nearest neighbor",
            "evolutionary_optimized_ml",
            "simulated_annealing",
            lambda x, y, seed: build_evolution_model(
                x,
                y,
                seed,
                factory_knn,
                decode_knn,
                [(2, 25), (1, 2), (0, 1)],
                lambda *args: sa_search(*args, iterations=30),
            ),
            "Simulated annealing tunes KNN k, distance metric, and weights.",
        ),
        EvolutionSpec(
            "GWO_ExtraTrees",
            "bagging ensemble",
            "evolutionary_optimized_ml",
            "grey_wolf_optimizer",
            lambda x, y, seed: build_evolution_model(
                x,
                y,
                seed,
                factory_extratrees,
                decode_extratrees,
                [(60, 240), (2, 18), (1, 8), (0.35, 1.0)],
                lambda *args: gwo_search(*args, wolves=6, iterations=5),
            ),
            "Grey wolf optimizer tunes extremely randomized trees.",
        ),
    ]
    if XGBRegressor is not None:
        specs.append(
            EvolutionSpec(
                "DE_XGBoost",
                "boosting ensemble",
                "evolutionary_optimized_ml",
                "differential_evolution",
                lambda x, y, seed: build_de_model(
                    x,
                    y,
                    seed,
                    factory_xgb,
                    decode_xgb,
                    [(60, 240), (-2.0, -0.7), (2, 5), (0.55, 1.0), (0.55, 1.0), (0.2, 5.0)],
                    maxiter=2,
                    popsize=3,
                ),
                "Differential evolution tunes XGBoost hyperparameters.",
            )
        )
    return specs


def build_evolution_model(
    x_train: pd.DataFrame,
    y_train: np.ndarray,
    seed: int,
    factory: Callable[[dict[str, object], int], Pipeline],
    decoder: Callable[[Iterable[float]], dict[str, object]],
    bounds: list[tuple[float, float]],
    searcher: Callable[
        [pd.DataFrame, np.ndarray, Callable[[dict[str, object], int], Pipeline], Callable[[Iterable[float]], dict[str, object]], list[tuple[float, float]], int],
        tuple[dict[str, object], dict[str, object]],
    ],
) -> tuple[Pipeline, dict[str, object]]:
    params, meta = searcher(x_train, y_train, factory, decoder, bounds, seed)
    model = factory(params, seed + 101)
    meta["best_params"] = json.dumps(params, sort_keys=True)
    return model, meta


def build_de_model(
    x_train: pd.DataFrame,
    y_train: np.ndarray,
    seed: int,
    factory: Callable[[dict[str, object], int], Pipeline],
    decoder: Callable[[Iterable[float]], dict[str, object]],
    bounds: list[tuple[float, float]],
    maxiter: int,
    popsize: int,
) -> tuple[Pipeline, dict[str, object]]:
    objective = cached_objective(x_train, y_train, factory, decoder, seed)
    result = differential_evolution(
        objective,
        bounds=bounds,
        seed=seed,
        maxiter=maxiter,
        popsize=popsize,
        polish=False,
        updating="immediate",
        workers=1,
        tol=0.02,
    )
    params = decoder(result.x)
    model = factory(params, seed + 101)
    meta = {
        "optimizer": "differential_evolution",
        "inner_cv_rmse": float(result.fun),
        "evaluations": len(objective.cache),
        "best_params": json.dumps(params, sort_keys=True),
    }
    return model, meta


def run_evolution_oof(df: pd.DataFrame, spec: EvolutionSpec, seed: int) -> tuple[pd.DataFrame, list[dict[str, object]], float]:
    y = df["Actual"].to_numpy(float)
    parts = []
    choice_rows = []
    start = time.perf_counter()
    for fold_id in sorted(df["FoldID"].unique()):
        fold_seed = seed + 1000 + int(fold_id) * 31
        train_idx = df["FoldID"].to_numpy() != fold_id
        test_idx = ~train_idx
        x_train = df.loc[train_idx].reset_index(drop=True)
        y_train = y[train_idx]
        model, meta = spec.search_runner(x_train, y_train, fold_seed)
        model.fit(x_train, y_train)
        pred = np.asarray(model.predict(df.loc[test_idx]), dtype=float)
        part = pd.DataFrame(
            {
                "Model": spec.model_name,
                "ModelFamily": spec.model_family,
                "BenchmarkGroup": spec.benchmark_group,
                "FeatureSet": "raw_engineered_context",
                "RowID": df.loc[test_idx, "RowID"].astype(int).to_numpy(),
                "FoldID": df.loc[test_idx, "FoldID"].astype(int).to_numpy(),
                "CowKey": df.loc[test_idx, "CowKey"].astype(str).to_numpy(),
                "Source": df.loc[test_idx, "Source"].astype(str).to_numpy(),
                "Actual": y[test_idx],
                "Predicted": pred,
            }
        )
        parts.append(part)
        choice_rows.append(
            {
                "Model": spec.model_name,
                "ModelFamily": spec.model_family,
                "Optimizer": spec.optimizer,
                "FoldID": int(fold_id),
                "InnerCV_RMSE": meta.get("inner_cv_rmse"),
                "Evaluations": meta.get("evaluations"),
                "BestParams": meta.get("best_params"),
                "Notes": spec.notes,
            }
        )
        print(
            f"[evolution] {spec.model_name} fold {fold_id}: inner_rmse={meta.get('inner_cv_rmse'):.4f} "
            f"evals={meta.get('evaluations')} params={meta.get('best_params')}",
            flush=True,
        )
    elapsed = time.perf_counter() - start
    return pd.concat(parts, ignore_index=True), choice_rows, elapsed


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    if not rows:
        raise ValueError(f"No rows to write: {path}")
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def write_markdown(
    path: Path,
    summary: pd.DataFrame,
    conventional_count: int,
    evolution_count: int,
    prediction_path: Path,
    elapsed_seconds: float,
) -> None:
    ranked = summary.sort_values(["R2", "RMSE"], ascending=[False, True]).copy()
    rows = [
        "# 33-model benchmark",
        "",
        f"Models: {conventional_count + evolution_count + 1}; rows per model: 503; elapsed: {elapsed_seconds:.1f} s.",
        "",
        "| Model | R2 | RMSE (C) | MAE (C) |",
        "|---|---:|---:|---:|",
    ]
    for _, row in ranked.head(12).iterrows():
        rows.append(
            f"| {row['Model']} | {float(row['R2']):.4f} | {float(row['RMSE']):.4f} | {float(row['MAE']):.4f} |"
        )
    rows.extend([
        "",
        "Validation: same-cow random five-fold OOF. Hyperparameter search uses training-fold data only.",
        "",
    ])
    path.write_text("\n".join(rows), encoding="utf-8")


def verify_against_reference(
    summary_df: pd.DataFrame,
    inventory_df: pd.DataFrame,
    reference_path: Path,
    tolerance: float,
) -> dict[str, object]:
    reference = pd.read_csv(reference_path)
    metric_columns = ["R2", "RMSE", "MAE"]
    compared = summary_df[["Model", *metric_columns]].merge(
        reference[["Model", *metric_columns]],
        on="Model",
        how="outer",
        suffixes=("_retrained", "_frozen"),
        indicator=True,
    )
    compared_models = compared.loc[compared["_merge"] == "both"].copy()
    for metric in metric_columns:
        compared_models[f"{metric}_abs_difference"] = (
            compared_models[f"{metric}_retrained"]
            - compared_models[f"{metric}_frozen"]
        ).abs()
    difference_columns = [f"{metric}_abs_difference" for metric in metric_columns]
    max_difference = (
        float(compared_models[difference_columns].to_numpy(float).max())
        if not compared_models.empty
        else float("inf")
    )
    missing_retrained = compared.loc[
        compared["_merge"] == "right_only", "Model"
    ].astype(str).tolist()
    unexpected_models = compared.loc[
        compared["_merge"] == "left_only", "Model"
    ].astype(str).tolist()
    failed_models = inventory_df.loc[
        inventory_df["RunStatus"] != "done", "Model"
    ].astype(str).tolist()
    expected_count = int(reference["Model"].nunique())
    actual_count = int(summary_df["Model"].nunique())
    status = "PASS" if (
        expected_count == 33
        and actual_count == expected_count
        and not missing_retrained
        and not unexpected_models
        and not failed_models
        and max_difference <= tolerance
    ) else "FAIL"
    return {
        "status": status,
        "validation_design": "same-cow random five-fold OOF",
        "rows_per_model": 503,
        "expected_model_count": expected_count,
        "retrained_model_count": actual_count,
        "metric_tolerance": tolerance,
        "max_metric_abs_difference": max_difference,
        "missing_retrained_models": missing_retrained,
        "unexpected_models": unexpected_models,
        "failed_models": failed_models,
        "metric_differences": compared_models[
            ["Model", *difference_columns]
        ].to_dict(orient="records"),
    }


def runtime_environment(seed: int) -> dict[str, object]:
    package_names = [
        "numpy",
        "pandas",
        "scipy",
        "scikit-learn",
        "xgboost",
        "lightgbm",
    ]
    packages = {}
    for package_name in package_names:
        try:
            packages[package_name] = importlib_metadata.version(package_name)
        except importlib_metadata.PackageNotFoundError:
            packages[package_name] = None
    return {
        "python": platform.python_version(),
        "implementation": platform.python_implementation(),
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
        },
        "packages": packages,
        "random_seed": seed,
        "outer_validation": "same-cow random five-fold OOF",
        "inner_evolution_search": "three-fold CV within each outer-training fold",
    }


def run(args: argparse.Namespace) -> dict[str, object]:
    random.seed(args.seed)
    np.random.seed(args.seed)
    prediction_path = args.input.resolve()
    reference_path = args.reference.resolve()
    output_dir = args.output_dir.resolve()
    tables_dir = output_dir / "表格"
    tables_dir.mkdir(parents=True, exist_ok=True)
    df = load_data(prediction_path)

    all_predictions: list[pd.DataFrame] = []
    all_summary: list[dict[str, object]] = []
    all_fold_metrics: list[dict[str, object]] = []
    inventory: list[dict[str, object]] = []
    search_choices: list[dict[str, object]] = []

    start_all = time.perf_counter()

    reference = prediction_rows_for_reference(df)
    all_predictions.append(reference)
    ref_summary = summary_row(
        PROPOSED_MODEL_NAME,
        "stacked compensation",
        "proposed_model_reference",
        "three_component_oof_predictions_plus_fold_specific_ridge_stack",
        reference,
        0.0,
        "Saved OOF predictions from the strict three-model stacked-compensation pipeline.",
    )
    all_summary.append(ref_summary)
    all_fold_metrics.extend(
        fold_metric_rows(
            PROPOSED_MODEL_NAME,
            "stacked compensation",
            "proposed_model_reference",
            reference,
            0.0,
            "Saved OOF predictions from strict stack.",
        )
    )
    inventory.append(
        {
            "Model": PROPOSED_MODEL_NAME,
            "ModelFamily": "stacked compensation",
            "BenchmarkGroup": "proposed_model_reference",
            "FeatureSet": "three_component_oof_predictions_plus_fold_specific_ridge_stack",
            "RunStatus": "done",
            "Notes": "Reference proposed model from strict stack predictions.",
        }
    )

    conventional_specs = conventional_model_specs()
    if args.max_conventional_models:
        conventional_specs = conventional_specs[: args.max_conventional_models]
    for index, spec in enumerate(conventional_specs, start=1):
        print(f"[model {index}/{len(conventional_specs)}] {spec.model_name}", flush=True)
        try:
            predictions, elapsed, warning = run_oof_model(df, spec, args.seed)
            all_predictions.append(predictions)
            all_summary.append(
                summary_row(
                    spec.model_name,
                    spec.model_family,
                    spec.benchmark_group,
                    spec.feature_set,
                    predictions,
                    elapsed,
                    spec.notes + (f" Warning: {warning}" if warning else ""),
                )
            )
            all_fold_metrics.extend(
                fold_metric_rows(spec.model_name, spec.model_family, spec.benchmark_group, predictions, elapsed, spec.notes)
            )
            inventory.append(
                {
                    "Model": spec.model_name,
                    "ModelFamily": spec.model_family,
                    "BenchmarkGroup": spec.benchmark_group,
                    "FeatureSet": spec.feature_set,
                    "RunStatus": "done",
                    "Notes": spec.notes,
                }
            )
        except Exception as exc:
            inventory.append(
                {
                    "Model": spec.model_name,
                    "ModelFamily": spec.model_family,
                    "BenchmarkGroup": spec.benchmark_group,
                    "FeatureSet": spec.feature_set,
                    "RunStatus": "failed",
                    "Notes": f"{type(exc).__name__}: {exc}",
                }
            )
            print(f"[failed] {spec.model_name}: {exc}", flush=True)
            if args.fail_fast:
                raise

    evolution_specs = [] if args.skip_evolution else make_evolution_specs()
    if args.max_evolution_models:
        evolution_specs = evolution_specs[: args.max_evolution_models]
    for index, spec in enumerate(evolution_specs, start=1):
        print(f"[evolution model {index}/{len(evolution_specs)}] {spec.model_name}", flush=True)
        try:
            predictions, choices, elapsed = run_evolution_oof(df, spec, args.seed)
            all_predictions.append(predictions)
            search_choices.extend(choices)
            all_summary.append(
                summary_row(
                    spec.model_name,
                    spec.model_family,
                    spec.benchmark_group,
                    "raw_engineered_context",
                    predictions,
                    elapsed,
                    spec.notes,
                )
            )
            all_fold_metrics.extend(
                fold_metric_rows(spec.model_name, spec.model_family, spec.benchmark_group, predictions, elapsed, spec.notes)
            )
            inventory.append(
                {
                    "Model": spec.model_name,
                    "ModelFamily": spec.model_family,
                    "BenchmarkGroup": spec.benchmark_group,
                    "FeatureSet": "raw_engineered_context",
                    "RunStatus": "done",
                    "Notes": spec.notes,
                }
            )
        except Exception as exc:
            inventory.append(
                {
                    "Model": spec.model_name,
                    "ModelFamily": spec.model_family,
                    "BenchmarkGroup": spec.benchmark_group,
                    "FeatureSet": "raw_engineered_context",
                    "RunStatus": "failed",
                    "Notes": f"{type(exc).__name__}: {exc}",
                }
            )
            print(f"[failed] {spec.model_name}: {exc}", flush=True)
            if args.fail_fast:
                raise

    elapsed_all = time.perf_counter() - start_all

    summary_df = pd.DataFrame(all_summary).sort_values(["R2", "RMSE"], ascending=[False, True])
    fold_df = pd.DataFrame(all_fold_metrics).sort_values(["Model", "FoldID"])
    prediction_df = pd.concat(all_predictions, ignore_index=True).sort_values(["Model", "RowID"])
    inventory_df = pd.DataFrame(inventory).sort_values(["BenchmarkGroup", "Model"])
    choices_df = pd.DataFrame(search_choices)
    if choices_df.empty:
        choices_df = pd.DataFrame(
            columns=["Model", "ModelFamily", "Optimizer", "FoldID", "InnerCV_RMSE", "Evaluations", "BestParams", "Notes"]
        )

    summary_path = tables_dir / "14_full_model_benchmark_summary.csv"
    fold_path = tables_dir / "14_full_model_benchmark_fold_metrics.csv"
    predictions_path = tables_dir / "14_full_model_benchmark_predictions.csv"
    inventory_path = tables_dir / "14_full_model_benchmark_model_inventory.csv"
    choices_path = tables_dir / "14_evolutionary_search_choices.csv"
    markdown_path = output_dir / "benchmark_reproduction_report.md"
    verification_path = output_dir / "benchmark_verification.json"
    environment_path = output_dir / "runtime_environment.json"

    summary_df.to_csv(summary_path, index=False, encoding="utf-8-sig")
    fold_df.to_csv(fold_path, index=False, encoding="utf-8-sig")
    prediction_df.to_csv(predictions_path, index=False, encoding="utf-8-sig")
    inventory_df.to_csv(inventory_path, index=False, encoding="utf-8-sig")
    choices_df.to_csv(choices_path, index=False, encoding="utf-8-sig")
    write_markdown(
        markdown_path,
        summary_df,
        len(conventional_specs),
        len(evolution_specs),
        Path("数据/处理数据/th_shrc_oof_predictions.csv"),
        elapsed_all,
    )
    verification = verify_against_reference(
        summary_df,
        inventory_df,
        reference_path,
        args.metric_tolerance,
    )
    verification_path.write_text(
        json.dumps(verification, indent=2) + "\n",
        encoding="utf-8",
    )
    environment_path.write_text(
        json.dumps(runtime_environment(args.seed), indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Wrote {summary_path}")
    print(f"Wrote {fold_path}")
    print(f"Wrote {predictions_path}")
    print(f"Wrote {inventory_path}")
    print(f"Wrote {choices_path}")
    print(f"Wrote {markdown_path}")
    print(f"Wrote {verification_path}")
    print(f"Wrote {environment_path}")
    print(summary_df[["Model", "BenchmarkGroup", "R2", "RMSE", "MAE"]].head(15).to_string(index=False))
    print(f"BENCHMARK_STATUS={verification['status']}")
    return verification


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run full linear/ML/evolutionary model benchmark.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--reference", type=Path, default=DEFAULT_REFERENCE)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--seed", type=int, default=20260709)
    parser.add_argument("--metric-tolerance", type=float, default=0.02)
    parser.add_argument("--skip-evolution", action="store_true")
    parser.add_argument("--max-conventional-models", type=int, default=0)
    parser.add_argument("--max-evolution-models", type=int, default=0)
    parser.add_argument("--fail-fast", action="store_true")
    args = parser.parse_args()
    if args.max_conventional_models == 0:
        args.max_conventional_models = None
    if args.max_evolution_models == 0:
        args.max_evolution_models = None
    return args


if __name__ == "__main__":
    result = run(parse_args())
    raise SystemExit(0 if result["status"] == "PASS" else 1)
