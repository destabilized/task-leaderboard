# mvths robotics task leaderboard

taskboard for the mvths engineering shop that tracks the amount of tasks you have completed and the amount of points you recieved for the tasks. tasks are tracked in a  google sheet which lists the start date, finish date, points, task, and who is completing the task. whenever the sheet updates, the leaderboard updates as well. 

static site—it's a published csv sheet that is pulled from the browser and computes all the scores on the client, repolling every few seconds


## features

- **live updates** — the page polls the published sheet every 5 seconds, so
  scores refresh almost immediately after the sheet changes.
- **rankings** — sort by total points or completed tasks, filter by timeframe
  (24h / 5d / 30d / all time) and grade, and search across every name.
- **per-student breakdown** — expand any row to see every task: its dates and
  points, with any grade bonus noted underneath.
- **mobile friendly** — responsive layout, compact detail view, and
  tap-to-expand on small screens.
- **shop tasks page** — `/tasks/` lists every task; students can claim an
  open task, mark a claimed task done, and reclaim a task that has sat
  unclaimed for a while (see [claiming tasks](#claiming-tasks)).

## scoring 

the amount of points given per task is based on what the teachers (mr. christy and mr. l) deem as appropriate. harder to finish tasks (such as fixing / making something) will always be worth more than sorting / putting items away. 

when multiple people are listed on a task, the task's points are divided evenly between them instead of each person getting the full amount. shares are rounded to the nearest 0.5 points (ties round up), so a 3 point task split between 2 people is worth 1.5 each, between 4 people is 1 each, and between 5 people is 0.5 each.

in addition, to incentivize underclassmen to do more tasks, there are additional point bonuses based on your grade:

+0.2 points for sophomores and +0.1 points for juniors

## tech stack

- **vanilla js + css**, no build step, no dependencies
- **google sheets** published csv export
- **5s client-side polling** (no backend, no sse, no server)
- **google apps script** web app for writes (claim/done), optional

## claiming tasks

`/tasks/` lets students update the sheet from the browser:

- **claim** — an unclaimed task shows a `claim` button. clicking it asks for a
  name, then writes the name and today's date into the `Name` / `Start Date`
  columns.
- **done** — a claimed task shows a `done` button that writes today's date into
  the `End Date` column.
- **reclaim** — if a task has been claimed for more than 6 *school* days, a
  `reclaim` button appears (hover the days counter on desktop) to reassign it.
  weekends and any dates listed in `EXCLUDED_DAYS` in `src/js/scoring.js`
  don't count toward that timer. add breaks/holidays there in `YYYY-MM-DD`
  format.

these writes go through a google apps script web app (`apps-script/Code.gs`),
since the browser can't edit a sheet directly. to set it up:

1. open the sheet → **extensions → apps script**.
2. paste the contents of `apps-script/Code.gs`. adjust `SHEET_ID` / `SHEET_NAME`
   if needed.
3. **deploy → new deployment → web app**. set *execute as: me* and *who has
   access: anyone*, then deploy and copy the `/exec` url.
4. paste that url into `TASKS_API_URL` at the top of `src/js/tasks.js`.

if `TASKS_API_URL` is empty, the tasks page still works as a read-only view
but clicking claim/done shows a setup reminder.

## getting started (if you want to make something like this as well)
view `src/js/scoring.js` and change whatever needs to be changed. (sheet url, grades, websites, bonus points, etc.)

format a google sheet like the image below:
![google sheet formatting](src/imgs/example.webp)

## starting the server 
```bash
cd task-leaderboard

# serve the folder (any static server works)
python3 -m http.server 8000
```

open <http://localhost:8000>. the leaderboard is at `/` and the shop tasks
page is at `/tasks/`.
