from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, redirect, send_from_directory


BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"
DB_PATH = BASE_DIR / "temps.db"

app = Flask(__name__, static_folder=None)


def as_float(value):
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def classify_temperature(actual_temp, requirement, tolerance=2.0):
    actual = as_float(actual_temp)
    required = as_float(requirement)
    if actual is None or required is None:
        return "CRITICAL"
    return "CRITICAL" if actual - required >= tolerance else "OK"


def db_last_synced():
    if not DB_PATH.exists():
        return None
    return datetime.fromtimestamp(DB_PATH.stat().st_mtime, tz=timezone.utc).isoformat()


@app.after_request
def set_cache_headers(response):
    path = getattr(response, "_request_path", None)
    if path and path.endswith((".html", ".js", ".css")):
        response.cache_control.no_store = True
        response.cache_control.max_age = 0
    return response


@app.route("/")
def root():
    return redirect("/Temperature/index.html")


@app.route("/Temperature/<path:file_path>")
def temperature_assets(file_path):
    response = send_from_directory(FRONTEND_DIR / "Temperature", file_path)
    response._request_path = file_path
    return response


@app.route("/shared/<path:file_path>")
def shared_assets(file_path):
    response = send_from_directory(FRONTEND_DIR / "shared", file_path)
    response._request_path = file_path
    return response


@app.route("/static/<path:file_path>")
def static_assets(file_path):
    return send_from_directory(FRONTEND_DIR / "static", file_path)


@app.route("/api/page-sync/<page_key>")
def page_sync(page_key):
    return jsonify({
        "page": page_key,
        "last_synced": db_last_synced(),
    })


@app.route("/api/temperature/rooms")
def temperature_rooms():
    if not DB_PATH.exists():
        return jsonify([])

    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT * FROM room_temperature").fetchall()
        conn.close()
    except sqlite3.Error as exc:
        print(f"Temperature DB error: {exc}")
        return jsonify([])

    room_groups = {}
    for row in rows:
        room = dict(row)
        actual = as_float(room.get("Actual Temp"))
        required = as_float(room.get("Requirement"))
        diff = as_float(room.get("temp_diff"))
        status = classify_temperature(actual, required)
        max_normal = required + 2 if required is not None else None
        expected_range = {
            "min_normal": None,
            "max_normal": max_normal,
            "attention_buffer": None,
            "warning_buffer": 2,
            "label": f"Required {required:.2f} deg C, red at +2.00 deg C" if required is not None else None,
            "area_group": "Source temperature requirement",
            "configured": actual is not None and required is not None,
        }
        unit = {
            "unit_code": room.get("unit_code") or room.get("base_room"),
            "unit_label": room.get("unit_label") or room.get("room_name") or room.get("base_room"),
            "source_code": room.get("source_code") or room.get("unit_code") or room.get("base_room"),
            "Actual Temp": actual,
            "Requirement": required,
            "temp_diff": diff,
            "status": status,
            "expected_range": expected_range,
        }
        room_key = room.get("base_room") or unit["unit_code"]
        grouped = room_groups.setdefault(room_key, {
            **room,
            "status": status,
            "temperature_status": "NORMAL" if status == "OK" else "WARNING",
            "temperature_threshold_status": "NORMAL" if status == "OK" else "WARNING",
            "expected_range": expected_range,
            "energy": {"mapped": False, "available": False},
            "combined_insight": None,
            "Actual Temp": actual,
            "Requirement": required,
            "temp_diff": diff,
            "units": [],
        })
        grouped["units"].append(unit)

        if status == "CRITICAL" or grouped.get("Actual Temp") is None:
            grouped["status"] = "CRITICAL"
            grouped["temperature_status"] = "WARNING"
            grouped["temperature_threshold_status"] = "WARNING"
            grouped["Actual Temp"] = actual
            grouped["Requirement"] = required
            grouped["temp_diff"] = diff
            grouped["expected_range"] = expected_range

    return jsonify(list(room_groups.values()))


@app.route("/api/export/report")
def export_report_placeholder():
    return jsonify({"error": "Report export is not included in this standalone temperature clone."}), 501


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5001"))
    app.run(host="127.0.0.1", port=port)
