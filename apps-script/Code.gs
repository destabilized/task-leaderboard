/**
 * MVTHS Robotics task leaderboard — task claim/complete backend.
 *
 * Deploy this as a Web App (Deploy > New deployment > Web app) with:
 *   - Execute as: Me
 *   - Who has access: Anyone
 * Then paste the /exec URL into TASKS_API_URL in src/js/tasks.js.
 *
 * The site posts JSON as text/plain (a "simple" CORS request) so the
 * browser won't preflight/block it. The response is ignored by the page;
 * success is confirmed by re-reading the published CSV.
 */

var SHEET_ID = '1Vgi7cwCR110Nwbzy2nHhevbcVCJZGh3byrsZOwRQjqY';
var SHEET_NAME = ''; // '' = first sheet

var COLS = { task: 1, name: 2, points: 3, list: 4, start: 5, end: 6 };

function getSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  return SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];
}

function today_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'M/d/yyyy');
}

function blank_(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

// Loose name key: lowercase, letters/digits only. Mirrors nameKey in scoring.js.
function nameKey_(value) {
  return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Find the row for a task.
 *   mode 'empty' — task matches and columns name+end are both blank (claim)
 *   otherwise    — task matches and end is blank; if a name is given, prefer a
 *                  row whose name matches loosely, else fall back to the first
 *                  matching row (reclaim / done)
 */
function findRow_(sheet, task, name, mode) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  var values = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  var wantKey = nameKey_(name);
  var fallback = -1;

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (String(row[COLS.task - 1]).trim() !== String(task).trim()) continue;

    var rowName = row[COLS.name - 1];
    var end = row[COLS.end - 1];

    if (mode === 'empty') {
      if (blank_(rowName) && blank_(end)) return i + 2;
      continue;
    }

    if (!blank_(end)) continue;
    if (fallback === -1) fallback = i + 2;
    if (wantKey && nameKey_(rowName) === wantKey) return i + 2;
  }

  return fallback;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return json_({ ok: true, service: 'task-leaderboard' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad json' });
  }

  var action = String(body.action || '');
  var task = String(body.task || '').trim();
  var name = String(body.name || '').trim();

  if (!task) return json_({ ok: false, error: 'missing task' });

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    return json_({ ok: false, error: 'busy' });
  }

  try {
    var sheet = getSheet_();
    var row;

    if (action === 'claim') {
      row = findRow_(sheet, task, name, 'empty');
      if (row === -1) return json_({ ok: false, error: 'task already claimed' });
      if (!name) return json_({ ok: false, error: 'missing name' });
      sheet.getRange(row, COLS.name).setValue(name);
      sheet.getRange(row, COLS.start).setValue(today_());

    } else if (action === 'reclaim') {
      row = findRow_(sheet, task, name, 'any');
      if (row === -1) return json_({ ok: false, error: 'task not found' });
      if (!name) return json_({ ok: false, error: 'missing name' });
      sheet.getRange(row, COLS.name).setValue(name);
      sheet.getRange(row, COLS.start).setValue(today_());

    } else if (action === 'done') {
      row = findRow_(sheet, task, name, 'any');
      if (row === -1) return json_({ ok: false, error: 'task not found' });
      sheet.getRange(row, COLS.end).setValue(today_());

    } else {
      return json_({ ok: false, error: 'unknown action' });
    }

    return json_({ ok: true, action: action, task: task, row: row });

  } finally {
    lock.releaseLock();
  }
}
