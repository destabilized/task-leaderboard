/* leaderboard scoring engine — ported from app.py.
   Pure client-side: parses the published Google Sheet CSV and computes
   leaders, counts, points, and breakdowns. No backend.
   Task points are read straight from the sheet's "Points" column; a
   grade-level bonus is added on top. No keyword complexity or speed math. */

var LeaderboardScoring = (function () {
  'use strict';

  var SHEET_URL = 'https://docs.google.com/spreadsheets/d/1J6YyU7UEmhdiCUZxvAfVy1on6x0O-srnTMk-t3PS4H4/export?format=csv&gid=0';

  var USER_GRADES = {
    'Alex B.': 12, 'Quinn': 12, 'Lila': 12, 'Sydney': 12, 'Miles': 12,
    'Andrew': 12, 'Tim': 12, 'Asiya': 12, 'Alex P.': 12, 'Adam S.': 12,
    'Ben': 12, 'Jonas': 12, 'Ibrahim': 11, 'Adam D.': 11, 'Dom': 11,
    'Michael': 11, 'Koji': 10, 'Charles': 10, 'Liam': 10, 'Brandon': 10,
    'Ethan': 10, 'Jack': 10, 'Hank': 10, 'Henry': 10, 'Lucas': 10,
    'Landon': 10, 'Shay': 10,
  };

  var USER_WEBSITES = {
    'Alex B.': 'https://alexslbress.wordpress.com/',
    'Quinn': 'https://quinndufour.wordpress.com/',
    'Lila': 'https://lilagraham27.wordpress.com/',
    'Sydney': 'https://sydneyhamel.wordpress.com/',
    'Miles': 'https://www.mileshilliard.com/',
    'Andrew': 'https://www.andrewhuang.cc/',
    'Tim': 'https://timmy.greenlifestylelabs.com/',
    'Asiya': 'https://therealasiyakhalif.wordpress.com/posts/',
    'Alex P.': 'https://core2engineering.wordpress.com/',
    'Adam S.': 'https://adam6581.wixsite.com/adam',
    'Ben': 'https://benjismit.wordpress.com/',
    'Jonas': 'https://jonaswirz.wordpress.com/',
    'Ibrahim': 'https://www.ibrahimazeemi.com/',
    'Adam D.': 'https://adammindfulminutes-kqpwt.wordpress.com/',
    'Dom': 'https://domdomx13-ipnxw.wordpress.com/',
    'Michael': 'https://michaeltirella.wordpress.com/',
    'Koji': '', 'Charles': '', 'Liam': '', 'Brandon': '', 'Ethan': '',
    'Jack': '', 'Hank': '', 'Henry': '', 'Lucas': '', 'Landon': '', 'Shay': ''
  };

  var GRADE_BONUS = { 10: 0.2, 11: 0.1, 12: 0.0 };

  var NAME_CORRECTIONS = { 'Asyia': 'Asiya', };

  var CANONICAL_NAMES = {};
  Object.keys(USER_GRADES).forEach(function (n) { CANONICAL_NAMES[nameKey(n)] = n; });

  var DAY_MS = 24 * 60 * 60 * 1000;

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /* === csv parsing === */

  function parseCsvLine(line) {
    var fields = [];
    var current = '';
    var inQuotes = false;
    var i = 0;
    while (i < line.length) {
      var ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') {
          fields.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      i += 1;
    }
    fields.push(current.trim());
    return fields;
  }

  function parseCsv(text) {
    var lines = String(text).split('\n').map(function (l) { return l.trim(); })
      .filter(function (l) { return l.length > 0; });
    if (lines.length < 2) return [];
    var headers = parseCsvLine(lines[0]);
    var rows = [];
    for (var li = 1; li < lines.length; li++) {
      var values = parseCsvLine(lines[li]);
      var row = {};
      for (var h = 0; h < headers.length; h++) {
        var header = headers[h].replace(/^"|"$/g, '');
        if (!header) continue;
        row[header] = (values[h] || '').trim().replace(/^"|"$/g, '');
      }
      rows.push(row);
    }
    return rows;
  }

  /* === date handling === */

  function parseDate(value) {
    var v = String(value == null ? '' : value).trim().replace(/^"|"$/g, '');
    if (!v) return null;
    var     m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return localDate(+m[1], +m[2], +m[3]);
    m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return localDate(+m[3], +m[1], +m[2]);
    m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
    if (m) return localDate(expandYear(+m[3]), +m[1], +m[2]);
    m = v.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (m) return localDate(+m[1], +m[2], +m[3]);
    return null;
  }

  function expandYear(yy) {
    if (yy >= 100) return yy;
    return yy < 70 ? 2000 + yy : 1900 + yy;
  }

  function localDate(y, m, d) {
    return new Date(y, m - 1, d);
  }

  function isoDate(d) {
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* === names === */

  function splitNames(nameStr) {
    if (!nameStr) return [];
    var cleaned = String(nameStr).replace(/"/g, '').replace(/\u201c/g, '').replace(/\u201d/g, '');
    var parts = cleaned.split(/\s*(?:,|\/|\band\b|&)\s*/i);
    return parts.map(function (n) { return n.trim(); }).filter(function (n) { return n.length > 0; });
  }

  function nameKey(name) {
    return String(name == null ? '' : name).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function normalizeName(name) {
    var n = String(name == null ? '' : name)
      .replace(/,/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\.$/, '');
    n = n.replace(/(^|\s)([A-Za-z])$/, '$1$2.');
    n = NAME_CORRECTIONS[n] || n;
    return CANONICAL_NAMES[nameKey(n)] || n;
  }

  function isIgnoredName(name) {
    var key = String(name == null ? '' : name).toLowerCase().replace(/[^a-z0-9]/g, '');
    return key === 'everyone' || key === 'mrl';
  }

  function isCompleted(row) {
    return Boolean(row['End Date']);
  }

  /* === scoring === */

  function scoreTask(points, name) {
    var base = Number(points);
    if (!isFinite(base) || base < 0) base = 0;
    base = round2(base);
    var grade = USER_GRADES[name] !== undefined ? USER_GRADES[name] : 9;
    var bonus = GRADE_BONUS[grade] !== undefined ? GRADE_BONUS[grade] : 0.0;
    var weighted = round2(base + bonus);

    return {
      grade: grade,
      base_points: base,
      grade_bonus: bonus,
      weighted_points: weighted,
    };
  }

  function processRows(rows) {
    var mentioned = {};

    rows.forEach(function (r) {
      splitNames(r['Name'] || '').forEach(function (rawName) {
        var n = normalizeName(rawName);
        if (!isIgnoredName(n)) mentioned[n] = true;
      });
    });

    var tasks = [];
    rows.forEach(function (r) {
      if (!isCompleted(r)) return;
      var start = parseDate(r['Start Date']);
      var end = parseDate(r['End Date']);
      if (!end) return;
      if (!start) start = end;
      splitNames(r['Name'] || '').forEach(function (rawName) {
        var n = normalizeName(rawName);
        if (!isIgnoredName(n)) {
          tasks.push({ task: (r['Task'] || '').trim(), name: n, start: start, end: end, points: r['Points'] });
        }
      });
    });

    return { tasks: tasks, mentioned: Object.keys(mentioned) };
  }

  function countCompletedTasks(rows) {
    var counts = { all: 0, '24h': 0, '5d': 0, '30d': 0 };
    var seen = {};
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var yesterday = new Date(today.getTime() - DAY_MS);

    rows.forEach(function (r) {
      if (!isCompleted(r)) return;
      var end = parseDate(r['End Date']);
      if (!end) return;
      var key = JSON.stringify([(r['Task'] || '').trim(), r['Start Date'], r['End Date']]);
      if (seen[key]) return;
      seen[key] = true;

      counts.all++;
      if (end.getTime() === today.getTime() || end.getTime() === yesterday.getTime()) counts['24h']++;
      var endMidnight = new Date(end.getFullYear(), end.getMonth(), end.getDate());
      if (now.getTime() - endMidnight.getTime() <= 5 * DAY_MS) counts['5d']++;
      if (now.getTime() - endMidnight.getTime() <= 30 * DAY_MS) counts['30d']++;
    });

    return counts;
  }

  function computeUsers(rows) {
    var processed = processRows(rows);
    var tasks = processed.tasks;
    var mentioned = processed.mentioned;
    var users = {};

    var allNames = {};
    mentioned.forEach(function (n) { allNames[n] = true; });
    Object.keys(USER_GRADES).forEach(function (n) { allNames[n] = true; });

    Object.keys(allNames).forEach(function (name) {
      if (!isIgnoredName(name)) {
        users[name] = { grade: USER_GRADES[name] !== undefined ? USER_GRADES[name] : 9, website: null, tasks: [] };
      }
    });

    tasks.forEach(function (t) {
      var s = scoreTask(t.points, t.name);
      if (!users[t.name]) {
        users[t.name] = { grade: s.grade, website: null, tasks: [] };
      }
      users[t.name].tasks.push({
        task: t.task,
        start: isoDate(t.start),
        end: isoDate(t.end),
        base_points: s.base_points,
        grade_bonus: s.grade_bonus,
        weighted_points: s.weighted_points,
      });
    });

    Object.keys(users).forEach(function (name) {
      users[name].grade = USER_GRADES[name] !== undefined ? USER_GRADES[name] : 9;
      users[name].website = USER_WEBSITES[name] || null;
    });

    return users;
  }

  function displayName(rawName) {
    return splitNames(rawName || '').map(normalizeName).join(', ');
  }

  function listAllTasks(rows) {
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var list = [];

    rows.forEach(function (r) {
      var task = (r['Task'] || '').trim();
      if (!task) return;

      var name = displayName(r['Name']);
      var start = parseDate(r['Start Date']);
      var end = parseDate(r['End Date']);
      var points = Number(r['Points']);
      if (!isFinite(points)) points = null;

      var claim = start;
      if (!claim && name) claim = parseDate(r['List Date']);

      var daysClaimed = null;
      if (claim) {
        var claimMid = new Date(claim.getFullYear(), claim.getMonth(), claim.getDate());
        daysClaimed = Math.max(0, Math.round((today.getTime() - claimMid.getTime()) / DAY_MS));
      }

      list.push({
        task: task,
        name: name,
        points: points,
        start: claim ? isoDate(claim) : '',
        end: end ? isoDate(end) : '',
        completed: Boolean(end),
        days_claimed: daysClaimed,
      });
    });

    return list;
  }

  /* === public api === */

  function loadSheetCSV() {
    var url = SHEET_URL + (SHEET_URL.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now();
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    });
  }

  function buildPayload(csvText) {
    var rows = parseCsv(csvText);
    return {
      type: 'data',
      sheet_url: SHEET_URL,
      source: 'google-sheet',
      generated_at: new Date().toISOString(),
      task_counts: countCompletedTasks(rows),
      users: computeUsers(rows),
    };
  }

  return {
    SHEET_URL: SHEET_URL,
    parseCsv: parseCsv,
    parseDate: parseDate,
    splitNames: splitNames,
    processRows: processRows,
    countCompletedTasks: countCompletedTasks,
    computeUsers: computeUsers,
    listAllTasks: listAllTasks,
    normalizeName: normalizeName,
    loadSheetCSV: loadSheetCSV,
    buildPayload: buildPayload,
  };
})();