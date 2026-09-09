import hashlib
import json
import os
import queue
import re
import threading
import time
from datetime import datetime, timedelta

import requests
from flask import Flask, Response, jsonify, request, send_from_directory

APP_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(APP_DIR, 'static')
CONFIG_FILE = os.path.join(APP_DIR, 'config.json')


POLL_INTERVAL = int(os.environ.get('POLL_INTERVAL', '1'))

SAMPLE_CSV = """Task,Name,List Date,Start Date,End Date
Sweep,Cleaning,2026-09-01,2026-09-01,2026-09-01
Sweep,Ben,2026-09-01,2026-09-01,2026-09-01
Setup Adblocker,Charles and Shay,2026-08-25,2026-08-26,2026-08-28
Install Battery,Everyone,2026-08-20,2026-08-21,2026-08-22
Install Battery,Ben and Hank,2026-08-22,2026-08-23,2026-08-24
Amplifier Setup,Quinn,2026-08-18,2026-08-19,2026-08-22
Reorganize Supplies,Alex,2026-08-10,2026-08-11,2026-08-15
Machine Shop Rework,Sydney and Quinn and Asyia,2026-08-05,2026-08-06,2026-08-12
Machine Shop Setup,Charlie,2026-09-02,2026-09-03,
Replace Battery,Ben,2026-09-01,2026-09-02,2026-09-03"""


USER_GRADES = {
    'Alex B.': 12, 'Quinn': 12, 'Lila': 12, 'Sydney': 12, 'Miles': 12,  
    'Andrew': 12, 'Tim': 12, 'Asiya': 12, 'Alex P.': 12, 'Adam S.': 12, 
    'Ben': 12,  'Jonas': 12, 'Ibrahim': 11, 'Adam D.': 11, 'Dom': 11, 
    'Michael': 11, 'Koji': 10, 'Charles': 10, 'Liam': 10, 'Brandon': 10, 
    'Ethan': 10, 'Jack': 10, 'Hank': 10, 'Henry': 10, 'Lucas': 10, 
    'Landon': 10, 'Shay': 10,
}

USER_WEBSITES = {
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
  'Koji': '',
  'Charles': '',
  'Liam': '',
  'Brandon': '',
  'Ethan': '',
  'Jack': '',
  'Hank': '',
  'Henry': '',
  'Lucas': '',
  'Landon': '',
  'Shay': ''
}


GRADE_BONUS = {10: 0.2, 11: 0.1, 12: 0.0}

KEYWORD_POINTS = {
  1: [
    'sweep', 'adblocker', 'battery', 'air out', 'check', 'replace', 
    'return', 'hang', 'clipboard', 'add', 'youtube', 'user lists', 
    'calipers', 'coolant', 'multimeter', '3d printers', 'sort', 'photos', 
    'plasma cutter', 'ensure', 'clips', 'bolts',
  ],

  3: [
    'setup', 'amplifier',  'fix', 'repair', 'update', 
    'move', 'take apart',  'formlabs', 'bambu', 'mills',
  ],

  5: [
    'organization', 'rework', 'machine shop', 'gridfinity', 'solder', 
    'circuit', 'stoplight', 'compliance', 'square', 'stock', 'typewriter'
  ]
}

NAME_CORRECTIONS = {
    'Asyia': 'Asiya',
}

# year month date format
EXCLUDED_DAYS = [
    '2026-9-4',
    '2026-9-7',
    '2026-9-21',
    '2026-10-12',
    '2026-11-3',
    '2026-11-11',
    '2026-11-26', 
    '2026-11-27',
    '2026-12-24',
    '2026-12-25',
    '2026-12-26',
    '2026-12-28',
    '2026-12-29',
    '2026-12-30',
    '2026-12-31',
    '2027-1-1',
    '2027-1-18',
    '2027-1-19',
    '2027-2-15',
    '2027-2-16',
    '2027-2-17',
    '2027-2-18',
    '2027-2-19',
    '2027-3-9',
    '2027-3-26',
    '2027-4-19',
    '2027-4-20',
    '2027-4-21',
    '2027-4-22',
    '2027-4-23',
    '2027-5-31',
    '2027-6-18',
]

state = {'sheet_url': '', 'data': None, 'task_counts': None, 'raw_hash': None, 'source': 'sample', 'generated_at': None}
state_lock = threading.Lock()
subscribers = []
subscribers_lock = threading.Lock()

app = Flask(__name__)


# === csv parsing ===

def parse_csv_line(line):
    fields = []
    current = ''
    in_quotes = False
    i = 0
    while i < len(line):
        ch = line[i]
        if in_quotes:
            if ch == '"':
                if i + 1 < len(line) and line[i + 1] == '"':
                    current += '"'
                    i += 1
                else:
                    in_quotes = False
            else:
                current += ch
        else:
            if ch == '"':
                in_quotes = True
            elif ch == ',':
                fields.append(current.strip())
                current = ''
            else:
                current += ch
        i += 1
    fields.append(current.strip())
    return fields


def parse_csv(text):
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    if len(lines) < 2:
        return []
    headers = parse_csv_line(lines[0])
    rows = []
    for line in lines[1:]:
        values = parse_csv_line(line)
        rows.append({headers[i]: (values[i] or '').strip() for i in range(len(headers))})
    return rows


def split_names(name_str):
    if not name_str:
        return []
    cleaned = name_str.replace('"', '').replace('\u201c', '').replace('\u201d', '')
    names = re.split(r'\s*(?:,|/|\band\b|&)\s*', cleaned)
    return [n.strip() for n in names if n.strip()]


def is_completed(row):
    return bool(row.get('End Date'))


def parse_date(value):
    value = (value or '').strip().strip('"')
    for fmt in ('%Y-%m-%d', '%m/%d/%Y', '%d/%m/%Y', '%Y/%m/%d'):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


# === data processing ===

def split_assignees(name_str):
    return split_names(name_str)


def process_rows(rows):
    mentioned = set()

    for r in rows:
        corrected = [NAME_CORRECTIONS.get(n, n) for n in split_assignees(r.get('Name', ''))]
        for n in corrected:
            if n.lower() != 'everyone':
                mentioned.add(n)

    tasks = []
    for r in rows:
        if not is_completed(r):
            continue
        start = parse_date(r.get('Start Date'))
        end = parse_date(r.get('End Date'))
        if end is None:
            continue
        if start is None:
            start = end
        names = split_assignees(r.get('Name', ''))
        assignees = []
        for n in names:
            n = NAME_CORRECTIONS.get(n, n)
            if n.lower() != 'everyone':
                assignees.append(n)
        for n in assignees:
            tasks.append({'task': (r.get('Task') or '').strip(), 'name': n, 'start': start, 'end': end})
    return tasks, mentioned


def count_completed_tasks(rows):
    counts = {'all': 0, '24h': 0, '5d': 0, '30d': 0}
    seen = set()
    now = datetime.now()
    today = now.date()
    yesterday = today - timedelta(days=1)
    for r in rows:
        if not is_completed(r):
            continue
        end = parse_date(r.get('End Date'))
        if end is None:
            continue
        key = ((r.get('Task') or '').strip(), r.get('Start Date'), r.get('End Date'))
        if key in seen:
            continue
        seen.add(key)
        counts['all'] += 1
        # 24h = completed yesterday or today
        if end == today or end == yesterday:
            counts['24h'] += 1
        end_dt = datetime(end.year, end.month, end.day)
        if now - end_dt <= timedelta(days=5):
            counts['5d'] += 1
        if now - end_dt <= timedelta(days=30):
            counts['30d'] += 1
    return counts


# === business days & scoring ===

def get_business_days(start, end):
    excluded = {parse_date(d) for d in EXCLUDED_DAYS if parse_date(d)}
    step = 1 if end >= start else -1
    count = 0
    cur = start
    while True:
        # skip weekends (5 = saturday, 6 = sunday) and excluded days
        if cur.weekday() not in (5, 6) and cur not in excluded:
            count += 1
        if cur == end:
            break
        cur += timedelta(days=step)
    return count


# speed bonus/penalty by complexity: harder tasks = bigger speed bonus + more leadway;
# easy tasks = smaller bonus + harsher penalty the longer they take
SPEED_RULES = {
    1: {'bonus': 0.5, 'bonus_days': 1, 'lead': 3, 'penalty_per_day': 1.5},
    3: {'bonus': 1, 'bonus_days': 2, 'lead': 5, 'penalty_per_day': 1.0},
    5: {'bonus': 1.5, 'bonus_days': 3, 'lead': 8, 'penalty_per_day': 0.5},
}


def speed_modifier(complexity, biz_days):
    r = SPEED_RULES.get(complexity) or SPEED_RULES[1]
    if biz_days <= r['bonus_days']:
        return r['bonus']
    if biz_days > r['lead']:
        over = biz_days - r['lead']
        return round(-(over * r['penalty_per_day']), 2)
    return 0


def score_task(task_name, start, end, name):
    task_lower = task_name.lower()
    complexity = 1
    for score, keywords in KEYWORD_POINTS.items():
        if any(kw in task_lower for kw in keywords):
            complexity = score
            break

    biz_days = get_business_days(start, end)
    speed = round(speed_modifier(complexity, biz_days), 2)
    # floor: can't lose more than you can earn, minimum 0.5 points no matter what
    speed = max(speed, round(0.5 - complexity, 2))
    raw = round(complexity + speed, 2)
    grade = USER_GRADES.get(name, 9)
    bonus = GRADE_BONUS.get(grade, 0.0)
    weighted = round(raw + bonus, 2)

    return {
        'grade': grade,
        'business_days': biz_days,
        'base_points': complexity,
        'speed_points': speed,
        'grade_bonus': bonus,
        'weighted_points': weighted,
    }


def compute_users(rows):
    tasks, mentioned = process_rows(rows)
    users = {}

    for name in mentioned | set(USER_GRADES.keys()):
        if name.lower() == 'everyone':
            continue
        users[name] = {'grade': USER_GRADES.get(name, 9), 'website': None, 'tasks': []}

    for t in tasks:
        s = score_task(t['task'], t['start'], t['end'], t['name'])

        users.setdefault(t['name'], {'grade': s['grade'], 'website': None, 'tasks': []})
        users[t['name']]['tasks'].append({
            'task': t['task'],
            'start': t['start'].isoformat(),
            'end': t['end'].isoformat(),
            'business_days': s['business_days'],
            'base_points': s['base_points'],
            'speed_points': s['speed_points'],
            'grade_bonus': s['grade_bonus'],
            'weighted_points': s['weighted_points'],
        })

    for name, u in users.items():
        u['grade'] = USER_GRADES.get(name, 9)
        u['website'] = USER_WEBSITES.get(name) or None

    return users


# === config persistence ===

def load_config():
    env_url = os.environ.get('SHEET_URL', '').strip()
    if env_url:
        state['sheet_url'] = env_url
        return
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE) as f:
                cfg = json.load(f)
            state['sheet_url'] = cfg.get('sheet_url', '')
        except Exception:
            pass


def save_config(url):
    if os.environ.get('SHEET_URL'):
        return
    try:
        with open(CONFIG_FILE, 'w') as f:
            json.dump({'sheet_url': url}, f)
    except OSError:
        pass


# === sse mechanism ===

def build_payload():
    with state_lock:
        return {
            'type': 'data',
            'sheet_url': state['sheet_url'],
            'source': state['source'],
            'generated_at': state['generated_at'],
            'task_counts': state['task_counts'],
            'users': state['data'],
        }


def broadcast(payload):
    message = f"data: {json.dumps(payload)}\n\n"
    with subscribers_lock:
        for q in list(subscribers):
            try:
                q.put_nowait(message)
            except queue.Full:
                pass


# === polling loop ===

def fetch_csv_text(url):
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.text


def single_poll():
    with state_lock:
        url = state['sheet_url']
        have_data = state['data'] is not None

    rows = None
    source = None

    if url:
        try:
            text = fetch_csv_text(url)
            rows = parse_csv(text)
            source = 'google-sheet'
        except Exception as exc:
            print(f'[poll] fetch failed: {exc}')
            if have_data:
                return
            rows = parse_csv(SAMPLE_CSV)
            source = 'sample'
    else:
        rows = parse_csv(SAMPLE_CSV)
        source = 'sample'

    users = compute_users(rows)
    task_counts = count_completed_tasks(rows)
    digest = hashlib.sha256(json.dumps(users, sort_keys=True).encode()).hexdigest()

    changed = False
    with state_lock:
        if digest != state['raw_hash']:
            state['data'] = users
            state['task_counts'] = task_counts
            state['raw_hash'] = digest
            state['source'] = source
            state['generated_at'] = datetime.utcnow().isoformat() + 'Z'
            changed = True

    if changed:
        print(f'[poll] data updated ({source})')
        broadcast({'type': 'update', **build_payload()})


def poll_loop():
    while True:
        try:
            single_poll()
        except Exception as exc:
            print(f'[poll] unexpected error: {exc}')
        time.sleep(POLL_INTERVAL)


# === api routes ===

@app.route('/')
def index():
    return send_from_directory(STATIC_DIR, 'index.html')


@app.route('/<path:filename>')
def static_files(filename):
    return send_from_directory(STATIC_DIR, filename)


@app.route('/api/data')
def api_data():
    return jsonify(build_payload())


@app.route('/api/source')
def api_source():
    with state_lock:
        return jsonify({'sheet_url': state['sheet_url'], 'source': state['source']})


@app.route('/api/config', methods=['POST'])
def set_config():
    body = request.get_json(silent=True) or {}
    url = (body.get('sheet_url') or '').strip()
    with state_lock:
        state['sheet_url'] = url
        state['raw_hash'] = None
    save_config(url)
    threading.Thread(target=single_poll, daemon=True).start()
    return jsonify({'ok': True, 'sheet_url': url})


@app.route('/api/events')
def events():
    q = queue.Queue(maxsize=50)

    def gen():
        with subscribers_lock:
            subscribers.append(q)
        try:
            with state_lock:
                data = state['data']
            if data is not None:
                yield f"data: {json.dumps({'type': 'snapshot', **build_payload()})}\n\n"
            while True:
                try:
                    message = q.get(timeout=15)
                    yield message
                except queue.Empty:
                    yield ': keepalive\n\n'
        except GeneratorExit:
            with subscribers_lock:
                if q in subscribers:
                    subscribers.remove(q)

    return Response(
        gen(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    )


# === startup ===

def start_server():
    load_config()
    threading.Thread(target=poll_loop, daemon=True).start()


start_server()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8000'))
    app.run(host='0.0.0.0', port=port, threaded=True, debug=False)
