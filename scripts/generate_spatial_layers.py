#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generate spatial interpolation layers for the dashboard (IDW grid clipped to the department).
Outputs GeoJSON files in outputs/spatial and updates an index.json for the client.
"""

import argparse
import json
from pathlib import Path

import numpy as np

try:
    from shapely.geometry import shape, Point
    from shapely.prepared import prep
except ImportError as exc:
    raise SystemExit("Missing dependency: shapely") from exc

try:
    from pyproj import Transformer
except ImportError as exc:
    raise SystemExit("Missing dependency: pyproj") from exc


VARIABLE_MAP = {
    "temperature": "temp_moy",
    "precipitation": "precipitation",
    "vent": "vent_moy"
}


def parse_args():
    parser = argparse.ArgumentParser(description="Spatial IDW layer generator for department 13.")
    parser.add_argument("--input", default="web/meteo_data.json", help="Path to meteo_data.json")
    parser.add_argument("--variable", required=True, choices=VARIABLE_MAP.keys())
    parser.add_argument("--period-type", required=True, choices=["day", "month"])
    parser.add_argument("--period", required=True, help="YYYYMMDD for day, YYYY-MM for month")
    parser.add_argument("--grid", type=float, default=2000, help="Grid resolution in meters (EPSG:2154)")
    parser.add_argument("--power", type=float, default=2.0, help="IDW power")
    parser.add_argument("--departement", default="data/raw/departement_13.geojson", help="Department GeoJSON (EPSG:2154)")
    parser.add_argument("--outdir", default="outputs/spatial", help="Output folder")
    parser.add_argument("--max-points", type=int, default=250000, help="Safety cap for grid points")
    return parser.parse_args()


def load_json(path):
    with open(path, "r", encoding="utf-8") as file:
        return json.load(file)


def select_station_values(data, variable_key, period_type, period):
    points = []
    for commune in data["communes"].values():
        if period_type == "day":
            row = next((d for d in commune["donnees"] if d["date_raw"] == period), None)
            value = None if row is None else row.get(variable_key)
        else:
            month_key = period.replace("-", "")
            rows = [d for d in commune["donnees"] if d["date_raw"].startswith(month_key)]
            values = [d.get(variable_key) for d in rows if d.get(variable_key) is not None]
            if not values:
                value = None
            elif variable_key == "precipitation":
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
    geo = load_json(path)
    geom = shape(geo["features"][0]["geometry"])
    return prep(geom), geom.bounds


def build_grid(bounds, resolution):
    minx, miny, maxx, maxy = bounds
    xs = np.arange(minx, maxx + resolution, resolution)
    ys = np.arange(miny, maxy + resolution, resolution)
    return np.meshgrid(xs, ys)


def idw_interpolate(xy, values, grid_points, power=2.0):
    coords = np.array(xy, dtype=float)
    vals = np.array(values, dtype=float)
    grid_x, grid_y = grid_points
    grid_vals = np.full(grid_x.shape, np.nan, dtype=float)

    flat_x = grid_x.ravel()
    flat_y = grid_y.ravel()
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
    return masked


def build_stats(values):
    valid = values[~np.isnan(values)]
    if valid.size == 0:
        return {"min": None, "max": None, "mean": None}
    return {
        "min": float(np.min(valid)),
        "max": float(np.max(valid)),
        "mean": float(np.mean(valid))
    }


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
    with open(path, "w", encoding="utf-8") as file:
        json.dump(geo, file, ensure_ascii=False)


def update_index(path, record):
    if path.exists():
        index = load_json(path)
    else:
        index = {"layers": []}
    index["layers"] = [
        layer for layer in index["layers"]
        if not (layer["variable"] == record["variable"]
                and layer["period"] == record["period"]
                and layer["period_type"] == record["period_type"])
    ]
    index["layers"].append(record)
    with open(path, "w", encoding="utf-8") as file:
        json.dump(index, file, ensure_ascii=False, indent=2)


def main():
    args = parse_args()
    if args.period_type == "day" and len(args.period) != 8:
        raise SystemExit("Day period must be YYYYMMDD.")
    if args.period_type == "month" and len(args.period) != 7:
        raise SystemExit("Month period must be YYYY-MM.")

    data = load_json(args.input)
    variable_key = VARIABLE_MAP[args.variable]
    stations = select_station_values(data, variable_key, args.period_type, args.period)
    if not stations:
        raise SystemExit("No stations with data for this period.")

    prepared_geom, bounds = load_department_mask(args.departement)
    to_l93 = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
    to_wgs84 = Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)

    xy = [to_l93.transform(p["lon"], p["lat"]) for p in stations]
    values = [p["value"] for p in stations]

    grid_x, grid_y = build_grid(bounds, args.grid)
    grid_vals = idw_interpolate(xy, values, (grid_x, grid_y), power=args.power)
    masked_vals = mask_grid(grid_x, grid_y, grid_vals, prepared_geom, args.max_points)

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    stem = f\"{args.variable}_{args.period}\"
    geojson_path = outdir / f\"{stem}.geojson\"
    export_geojson(str(geojson_path), grid_x, grid_y, masked_vals, to_wgs84)

    stats = build_stats(masked_vals)
    record = {
        \"variable\": args.variable,
        \"period_type\": args.period_type,
        \"period\": args.period,
        \"stats\": stats,
        \"geojson\": str(geojson_path).replace(\"\\\\\", \"/\")
    }
    update_index(outdir / \"index.json\", record)
    print(\"Generated:\", record)


if __name__ == \"__main__\":
    main()
