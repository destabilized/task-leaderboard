/* leaderboard scoring engine — ported from app.py.
   Pure client-side: parses the published Google Sheet CSV and computes
   leaders, counts, points, and breakdowns. No backend. */

var LeaderboardScoring = (function () {
  'use strict';

  var SHEET_URL = 'https://docs.google.com/spreadsheets/d/1Vgi7cwCR110Nwbzy2nHhevbcVCJZGh3byrsZOwRQjqY/export?format=csv&gid=0';

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

  var KEYWORD_POINTS = {
    1: ['sweep', 'adblocker', 'battery', 'air out', 'check', 'replace',
        'return', 'hang', 'clipboard', 'add', 'youtube', 'user lists',
        'calipers', 'coolant', 'multimeter', '3d printers', 'sort', 'photos',
        'plasma cutter', 'ensure', 'clips', 'bolts'],
    3: ['setup', 'amplifier', 'fix', 'repair', 'update',
        'move', 'take apart', 'formlabs', 'bambu', 'mills', 'debug'],
    5: ['organization', 'rework', 'machine shop', 'gridfinity', 'solder',
        'circuit', 'stoplight', 'compliance', 'square', 'stock', ]
  };

  var NAME_CORRECTIONS = { 'Asyia': 'Asiya' };

  var EXCLUDED_DAYS = [
    '2026-9-4', '2026-9-7', '2026-9-21', '2026-10-12', '2026-11-3',
    '2026-11-11', '2026-11-26', '2026-11-27', '2026-12-24', '2026-12-25',
    '2026-12-26', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31',
    '2027-1-1', '2027-1-18', '2027-1-19', '2027-2-15', '2027-2-16',
    '2027-2-17', '2027-2-18', '2027-2-19', '2027-3-9', '2027-3-26',
    '2027-4-19', '2027-4-20', '2027-4-21', '2027-4-22', '2027-4-23',
    '2027-5-31', '2027-6-18',
  ];

  var SPEED_RULES = {
    1: { bonus: 0.5, bonus_days: 1, lead: 3, penalty_per_day: 1.5 },
    3: { bonus: 1, bonus_days: 2, lead: 5, penalty_per_day: 1.0 },
    5: { bonus: 1.5, bonus_days: 3, lead: 8, penalty_per_day: 0.5 },
  };

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

  function isIgnoredName(name) {
    var key = String(name == null ? '' : name).toLowerCase().replace(/[^a-z0-9]/g, '');
    return key === 'everyone' || key === 'mrl';
  }

  function isCompleted(row) {
    return Boolean(row['End Date']);
  }

  /* === scoring === */

  function getBusinessDays(start, end) {
    var excluded = {};
    EXCLUDED_DAYS.forEach(function (d) {
      var dt = parseDate(d);
      if (dt) excluded[dt.getTime()] = true;
    });
    var step = end >= start ? 1 : -1;
    var cur = new Date(start.getTime());
    var count = 0;
    while (true) {
      var dow = cur.getDay();
      if (dow !== 0 && dow !== 6 && !excluded[cur.getTime()]) count++;
      if (cur.getTime() === end.getTime()) break;
      cur.setDate(cur.getDate() + step);
    }
    return count;
  }

  function speedModifier(complexity, bizDays) {
    var r = SPEED_RULES[complexity] || SPEED_RULES[1];
    if (bizDays <= r.bonus_days) return r.bonus;
    if (bizDays > r.lead) {
      var over = bizDays - r.lead;
      return round2(-(over * r.penalty_per_day));
    }
    return 0;
  }

  function scoreTask(taskName, start, end, name) {
    var taskLower = String(taskName).toLowerCase();
    var complexity = 1;
    [1, 3, 5].some(function (score) {
      if (KEYWORD_POINTS[score].some(function (kw) { return taskLower.indexOf(kw) !== -1; })) {
        complexity = score;
        return true;
      }
      return false;
    });

    var bizDays = getBusinessDays(start, end);
    var speed = round2(speedModifier(complexity, bizDays));
    speed = Math.max(speed, round2(0.5 - complexity));
    var raw = round2(complexity + speed);
    var grade = USER_GRADES[name] !== undefined ? USER_GRADES[name] : 9;
    var bonus = GRADE_BONUS[grade] !== undefined ? GRADE_BONUS[grade] : 0.0;
    var weighted = round2(raw + bonus);

    return {
      grade: grade,
      business_days: bizDays,
      base_points: complexity,
      speed_points: speed,
      grade_bonus: bonus,
      weighted_points: weighted,
    };
  }

  function processRows(rows) {
    var mentioned = {};

    rows.forEach(function (r) {
      splitNames(r['Name'] || '').forEach(function (rawName) {
        var n = NAME_CORRECTIONS[rawName] || rawName;
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
        var n = NAME_CORRECTIONS[rawName] || rawName;
        if (!isIgnoredName(n)) {
          tasks.push({ task: (r['Task'] || '').trim(), name: n, start: start, end: end });
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
      var s = scoreTask(t.task, t.start, t.end, t.name);
      if (!users[t.name]) {
        users[t.name] = { grade: s.grade, website: null, tasks: [] };
      }
      users[t.name].tasks.push({
        task: t.task,
        start: isoDate(t.start),
        end: isoDate(t.end),
        business_days: s.business_days,
        base_points: s.base_points,
        speed_points: s.speed_points,
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

  /* === public api === */

  function loadSheetCSV() {
    return fetch(SHEET_URL).then(function (res) {
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
    loadSheetCSV: loadSheetCSV,
    buildPayload: buildPayload,
  };
})();