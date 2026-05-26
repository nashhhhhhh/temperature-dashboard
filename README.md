# Temperature Dashboard Standalone

Standalone clone of the Stage 2 Temperature Monitoring Dashboard.

## Run Locally

```powershell
pip install -r requirements.txt
python app.py
```

Open:

```text
http://127.0.0.1:5001/Temperature/index.html
```

## Included

- Temperature dashboard HTML/CSS/JS
- Shared navbar assets
- Stage 2 floorplan image and room shape JSON
- Editable temperature requirements workbook:
  - `temperature_requirements.xlsx`
- Minimal Flask backend for:
  - `/api/temperature/rooms`
  - `/api/temperature/requirements`
  - `/api/page-sync/temperature`

## Temperature Requirements

Use the Download Excel button on the dashboard to get the current requirements workbook. Edit the `Requirement` column, then use Upload Excel to apply the new values.

The dashboard compares:

```text
Actual Temp from temps.db vs Requirement from temperature_requirements.xlsx
```

A room is out of tolerance when:

```text
Actual Temp - Requirement >= 2.0°C
```

The main Stage 2 dashboard is not modified by this clone.
