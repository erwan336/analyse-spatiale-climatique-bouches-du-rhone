#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Interpolation spatiale des stations meteo (IDW + option Kriging).
Exporte GeoTIFF/GeoJSON/PNG + stats et index pour le dashboard.
"""

import argparse
import json
import math
from datetime import datetime
from pathlib import Path

import numpy as np

try:
    from shapely.geometry import shape, Point
    from shapely.prepared import prep
except ImportError as exc:
    raise SystemExit("Missing dependency: shapely. Please install it in your env.") from exc

try:
    from pyproj import Transformer
except ImportError as exc:
    raise SystemExit("Missing dependency: pyproj. Please install it in your env.") from exc

try:
    import rasterio
    from rasterio.transform import from_origin
except ImportError:
    rasterio = None

try:
    import matplotlib.pyplot as plt
except ImportError:
    plt = None


def parse_args():
    parser = argparse.ArgumentParser(description="Interpolation IDW/Kriging sur le 13.")
    parser.add_argument("--input", default="web/meteo_data.json", help="Path meteo_data.json or CSV")
    parser.add_argument("--variable", required=True,
                        choices=["temp_min", "temp_max", "temp_moy", "precipitation", "vent_moy", "vent_max"])
    parser.add_argument("--date", help="Date AAAAMMJJ (ex: 20250115)")
    parser.add_argument("--month", help="Mois AAAA-MM (ex: 2025-01)")
    parser.add_argument("--method", default="idw", choices=["idw", "kriging"])
    parser.add_argument("--power", type=float, default=2.0, help="IDW power")
    parser.add_argument("--grid", type=float, default=2000, help="Grid resolution in meters (EPSG:2154)")
    parser.add_argument("--outdir", default="outputs/interpolation", help="Output folder")
    parser.add_argument("--departement", default="data/raw/departement_13.geojson",
                        help="GeoJSON departement in EPSG:2154")
    parser.add_argument("--max-points", type=int, default=250000, help="Safety cap for grid points")
    return parser.parse_args()


def load_meteo_json(path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data


def normalize_period(args):
    if args.date and args.month:
        raise SystemExit("Choose either --date or --month.")
    if not args.date and not args.month:
        raise SystemExit("Provide --date or --month.")
    if args.date:
        try:
            datetime.strptime(args.date, "%Y%m%d")
        except ValueError as exc:
            raise SystemExit("Date must be AAAAMMJJ.") from exc
        return "date", args.date
    try:
        datetime.strptime(args.month, "%Y-%m")
    except ValueError as exc:
        raise SystemExit("Month must be AAAA-MM.") from exc
    return "month", args.month


def select_station_values(data, variable, period_type, period_value):
    points = []
    for commune in data["communes"].values():
        if period_type == "date":
            row = next((d for d in commune["donnees"] if d["date_raw"] == period_value), None)
            value = None if row is None else row.get(variable)
        else:
            rows = [d for d in commune["donnees"] if d["date_raw"].startswith(period_value.replace("-", ""))]
            values = [d.get(variable) for d in rows if d.get(variable) is not None]
            if not values:
                value = None
            elif variable == "precipitation":
                value = float(np.sum(values))
            else:
                value = float(np.mean(values))

        if value is None:
            continue

        points.append({
            "name": commune["nom"],
            "lat": commune["latitude"],
            "lon": commune["longitude"],
            "value": float(value)
        })
    return points


def load_department_mask(path):
    with open(path, "r", encoding="utf-8") as f:
        geo = json.load(f)
    geom = shape(geo["features"][0]["geometry"])
    return prep(geom), geom.bounds


def build_grid(bounds, resolution):
    minx, miny, maxx, maxy = bounds
    xs = np.arange(minx, maxx + resolution, resolution)
    ys = np.arange(miny, maxy + resolution, resolution)
    grid_x, grid_y = np.meshgrid(xs, ys)
    return grid_x, grid_y


def idw_interpolate(xy, values, grid_points, power=2.0):
    coords = np.array(xy, dtype=float)
    vals = np.array(values, dtype=float)
    gx, gy = grid_points
    grid_vals = np.full(gx.shape, np.nan, dtype=float)

    flat_x = gx.ravel()
    flat_y = gy.ravel()
    chunk = 10000
    for start in range(0, flat_x.size, chunk):
        end = min(start + chunk, flat_x.size)
        px = flat_x[start:end]
        py = flat_y[start:end]
        dist = np.hypot(px[:, None] - coords[:, 0], py[:, None] - coords[:, 1])
        dist = np.where(dist == 0, 1e-6, dist)
        weights = 1 / (dist ** power)
        interp = np.sum(weights * vals[None, :], axis=1) / np.sum(weights, axis=1)
        grid_vals.ravel()[start:end] = interp

    return grid_vals


def kriging_interpolate(xy, values, grid_points):
    try:
        from pykrige.ok import OrdinaryKriging
    except ImportError as exc:
        raise SystemExit("Missing dependency: pykrige for kriging.") from exc
    coords = np.array(xy, dtype=float)
    vals = np.array(values, dtype=float)
    gx, gy = grid_points
    ok = OrdinaryKriging(coords[:, 0], coords[:, 1], vals, variogram_model="linear", verbose=False)
    z, _ = ok.execute("grid", gx[0, :], gy[:, 0])
    return np.array(z)


def mask_grid(grid_x, grid_y, grid_vals, prepared_geom, max_points):
    flat_x = grid_x.ravel()
    flat_y = grid_y.ravel()
    if flat_x.size > max_points:
        raise SystemExit(f"Grid too large ({flat_x.size} points). Increase resolution.")
    mask = np.zeros_like(flat_x, dtype=bool)
    for idx, (x, y) in enumerate(zip(flat_x, flat_y)):
        mask[idx] = prepared_geom.contains(Point(x, y))
    mask = mask.reshape(grid_x.shape)
    masked = np.where(mask, grid_vals, np.nan)
    return masked, mask


def export_geotiff(path, grid, transform, crs):
    if rasterio is None:
        print("rasterio not available, skipping GeoTIFF.")
        return
    data = grid.astype(np.float32)
    height, width = data.shape
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=height,
        width=width,
        count=1,
        dtype="float32",
        crs=crs,
        transform=transform,
        nodata=np.nan
    ) as dst:
        dst.write(data, 1)


def export_geojson(path, grid_x, grid_y, grid_vals, transformer):
    features = []
    flat_x = grid_x.ravel()
    flat_y = grid_y.ravel()
    flat_vals = grid_vals.ravel()
    for x, y, v in zip(flat_x, flat_y, flat_vals):
        if np.isnan(v):
            continue
        lon, lat = transformer.transform(x, y)
        features.append({
            "type": "Feature",
            "properties": {"value": float(v)},
            "geometry": {"type": "Point", "coordinates": [lon, lat]}
        })
    geo = {"type": "FeatureCollection", "features": features}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(geo, f, ensure_ascii=False)


def export_png(path, grid_vals):
    if plt is None:
        print("matplotlib not available, skipping PNG.")
        return
    plt.figure(figsize=(7, 6))
    plt.imshow(grid_vals, cmap="inferno", origin="lower")
    plt.colorbar(label="Valeur")
    plt.tight_layout()
    plt.savefig(path, dpi=150)
    plt.close()


def build_stats(grid_vals):
    valid = grid_vals[~np.isnan(grid_vals)]
    if valid.size == 0:
        return {"min": None, "max": None, "mean": None}
    return {
        "min": float(np.min(valid)),
        "max": float(np.max(valid)),
        "mean": float(np.mean(valid))
    }


def update_index(index_path, record):
    if index_path.exists():
        with open(index_path, "r", encoding="utf-8") as f:
            index = json.load(f)
    else:
        index = {"layers": []}
    index["layers"] = [r for r in index["layers"] if not (
        r["variable"] == record["variable"]
        and r["period"] == record["period"]
        and r["method"] == record["method"]
    )]
    index["layers"].append(record)
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)


def main():
    args = parse_args()
    period_type, period_value = normalize_period(args)
    data = load_meteo_json(args.input)

    stations = select_station_values(data, args.variable, period_type, period_value)
    if not stations:
        raise SystemExit("No stations with data for this period/variable.")

    prepared_geom, bounds = load_department_mask(args.departement)
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
    inv_transformer = Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)

    xy = [transformer.transform(p["lon"], p["lat"]) for p in stations]
    values = [p["value"] for p in stations]

    grid_x, grid_y = build_grid(bounds, args.grid)
    if args.method == "idw":
        grid_vals = idw_interpolate(xy, values, (grid_x, grid_y), power=args.power)
    else:
        grid_vals = kriging_interpolate(xy, values, (grid_x, grid_y))

    masked_vals, mask = mask_grid(grid_x, grid_y, grid_vals, prepared_geom, args.max_points)

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    stem = f"{args.variable}_{period_value}_{args.method}_grid{int(args.grid)}"

    stats = build_stats(masked_vals)
    stats_path = outdir / f"{stem}_stats.json"
    with open(stats_path, "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)

    transform = from_origin(grid_x.min(), grid_y.max(), args.grid, args.grid)
    geotiff_path = outdir / f"{stem}.tif"
    export_geotiff(str(geotiff_path), masked_vals, transform, "EPSG:2154")

    geojson_path = outdir / f"{stem}.geojson"
    export_geojson(str(geojson_path), grid_x, grid_y, masked_vals, inv_transformer)

    png_path = outdir / f"{stem}.png"
    export_png(str(png_path), masked_vals)

    record = {
        "variable": args.variable,
        "period": period_value,
        "period_type": period_type,
        "method": args.method,
        "grid": args.grid,
        "stats": stats,
        "geojson": str(geojson_path).replace("\\", "/"),
        "geotiff": str(geotiff_path).replace("\\", "/"),
        "png": str(png_path).replace("\\", "/")
    }
    update_index(outdir / "index.json", record)
    print("Done:", record)


if __name__ == "__main__":
    main()
