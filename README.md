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
- Minimal Flask backend for:
  - `/api/temperature/rooms`
  - `/api/page-sync/temperature`

The main Stage 2 dashboard is not modified by this clone.
