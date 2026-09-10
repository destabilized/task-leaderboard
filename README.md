# MVTHS Robotics Task Leaderboard

A live task leaderboard for the MVTHS Engineering shop. Completed tasks are
tracked in a Google Sheet, scored by complexity, speed, and grade level, and
displayed in everyone's browser in real time.

Fully **static** — no server. It fetches the published Sheet CSV straight from
the browser, computes all scores client-side, and re-polls every few seconds.

## Features

- **Live updates** — the page polls the published sheet every 5 seconds, so
  scores refresh almost immediately after the sheet changes.
- **Task scoring** — each task earns base points by complexity (1 / 3 / 5), a
  speed bonus or penalty (based on business days taken), and a small
  grade-level bonus.
- **Rankings** — sort by total points or completed tasks, filter by timeframe
  (24h / 5d / 30d / all time) and grade, and search across every name.
- **Per-student breakdown** — expand any row to see every task: dates, business
  days, base points, extra points, and totals.
- **Mobile friendly** — responsive layout, compact detail view, and
  tap-to-expand on small screens.
- **Mr. L is excluded** — assigned work is scored only for students.

## How scoring works

| Component | Rule |
| --- | --- |
| Complexity | Task name matched against keyword tiers → 1, 3, or 5 base points |
| Speed | Finished within a short window → bonus; over the lead time → per-day penalty |
| Grade bonus | Gr 10 `+0.2`, Gr 11 `+0.1`, Gr 12 `+0.0` (additive) |
| Floor | A task can never score below **0.5 points**, no matter how slow |

Business days skip weekends and the school calendar stored in `EXCLUDED_DAYS`
in `scoring.js`.

> Scoring rules (`SPEED_RULES`, `KEYWORD_POINTS`, `GRADE_BONUS`) are plain
> objects at the top of `scoring.js` — tune them without touching the UI.

## Tech stack

- **Vanilla JS + CSS**, no build step, no dependencies
- **Google Sheets** published CSV export
- **5-second client-side polling** (no backend, no SSE, no server)

## Getting started

```bash
cd task-leaderboard

# serve the folder (any static server works)
python3 -m http.server 8000
```

Open <http://localhost:8000>.

## Configuration

The only thing to configure is the sheet URL at the top of `scoring.js`:

```js
var SHEET_URL = 'https://docs.google.com/spreadsheets/d/<SHEET_ID>/export?format=csv&gid=0';
```

Use the **CSV export** URL of your sheet. Two ways to get one:

- From a sheet shared as **"anyone with the link can view"**:
  `.../spreadsheets/d/<SHEET_ID>/export?format=csv&gid=0`
- From a sheet **published to the web** (File → Share → Publish to web), the
  generated URL ends in `/pub?output=csv`.

The CSV headers are `Task, Name, List Date, Start Date, End Date`.

## Deploying

The site is plain static files — deploy anywhere you'd host a web page.

### GitHub Pages

1. Push this repo to GitHub.
2. Repo **Settings → Pages** → Source: "Deploy from a branch", branch `main`, `/` (root).
3. It goes live at `https://<user>.github.io/task-leaderboard`.

### Cloudflare Pages

1. Push this repo to GitHub.
2. In Cloudflare Pages → Create project → connect the repo.
3. Build command: *(none)*, output directory: `/`.

Either way, you can then attach a custom domain (e.g.
`leaderboard.mvthsengineering.com`) under the host's domain settings.

## Project structure

```
task-leaderboard/
├── index.html          # page markup
├── style.css           # dark terminal theme
├── scoring.js          # sheet parsing + scoring engine (ports the old backend logic)
├── app.js              # fetching, filtering, ranking, rendering
├── logo.svg            # mvths engineering mark
└── .nojekyll           # tells GitHub Pages it's a static site, not Jekyll
```

## License

[MIT](LICENSE) — © MVTHS Engineering.