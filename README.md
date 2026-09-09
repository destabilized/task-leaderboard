# MVTHS Robotics Task Leaderboard

A live task leaderboard for the MVTHS Engineering shop. Completed tasks are tracked in a Google Sheet, scored by complexity, speed, and grade level, and pushed to the leaderboard in real time over Server-Sent Events.

## Features

- **Live updates** — the backend polls the sheet and broadcasts changes to every open page over SSE, with a polling fallback for dropped connections.
- **Task scoring** — each task earns base points by complexity (1 / 3 / 5), a speed bonus or penalty (based on business days taken), and a small grade-level bonus.
- **Rankings** — sort by total points or completed tasks, filter by timeframe (24h / 5d / 30d / all time) and grade, and search across every name.
- **Per-student breakdown** — expand any row to see every task: dates, business days, base points, extra points, and totals.
- **Mobile friendly** — responsive layout, compact detail view, and tap-to-expand on small screens.

## How scoring works

| Component | Rule |
| --- | --- |
| Complexity | Task name matched against keyword tiers → 1, 3, or 5 base points |
| Speed | Finished within a short window → bonus; over the lead time → per-day penalty |
| Grade bonus |  sophomores `+0.2`, juniors `+0.1`, seniors `+0.0` (additive, not multiplicative) |
| Floor | A task can never score below **0.5 points**, no matter how slow |

Business days skip weekends and the school calendar stored in `EXCLUDED_DAYS`.

> Scoring rules (`SPEED_RULES`, `KEYWORD_POINTS`, `GRADE_BONUS`) are plain dictionaries at the top of `app.py` — tune them without touching the rest of the app.

## Tech stack

- **Backend** — Flask (Python 3.12+), requests, threading
- **Frontend** — vanilla JS + CSS, no build step
- **Realtime** — Server-Sent Events (`/api/events`) with content-hash change detection

## Getting started

```bash
# 1. clone and enter the project
git clone <your-repo-url> task-leaderboard
cd task-leaderboard

# 2. create a virtual environment and install deps
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3. configure your sheet (see below)
cp config.example.json config.json

# 4. run it
python app.py
```

Open <http://localhost:8000>.

## Configuration

`config.json` only needs the CSV export URL of a published Google Sheet:

```json
{
  "sheet_url": "https://docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=0"
}
```

Derive it from your sheet's address bar: `.../spreadsheets/d/<ID>/edit#gid=0` →
`.../spreadsheets/d/<ID>/export?format=csv&gid=0`. The CSV headers are
`Task, Name, List Date, Start Date, End Date`.

Environment variables:

| Variable | Purpose |
| --- | --- |
| `POLL_INTERVAL` | Seconds between sheet fetches (default `1`) |

## Project structure

```
task-leaderboard/
├── app.py                  # flask server, scoring, polling, sse
├── config.example.json     # template config (copy to config.json)
├── requirements.txt
├── static/
│   ├── index.html          # leaderboard markup
│   ├── style.css           # dark terminal theme
│   ├── app.js              # filtering, ranking, rendering
│   └── logo.svg            # mvths engineering mark
```

## API

| Endpoint | Description |
| --- | --- |
| `GET /` | Serves the leaderboard |
| `GET /api/data` | Full leaderboard payload (users, counts, source) |
| `GET /api/events` | SSE stream pushed on every data change |
| `GET /api/source` | Current sheet URL + data source |
| `POST /api/config` | Update the sheet URL at runtime |

If no `config.json` exists, the app boots with bundled sample data so it is
immediately usable.

## License

[MIT](LICENSE) — © MVTHS Engineering.
