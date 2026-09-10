/* === state === */
let usersData = {};
let taskCounts = null;
let activeRange = '24h';
let gradeFilter = 'all';
let searchQuery = '';
let expandedUser = null;
let sourceInfo = '';
let sortMode = 'points';

const REFRESH_MS = 5000;

const RANGE_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '5d': 5 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};


/* === timeframe filters === */

function parseDateStr(s) {
  const parts = String(s).split('-');
  if (parts.length !== 3) return null;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return isNaN(d.getTime()) ? null : d;
}

function withinRange(task, range) {
  if (range === 'all') return true;
  const end = parseDateStr(task.end);
  if (!end) return false;

  if (range === '24h') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return end.getTime() >= yesterday.getTime() && end.getTime() <= Date.now();
  }

  return (Date.now() - end.getTime()) <= RANGE_MS[range];
}


/* === data ingestion === */

function applyPayload(payload) {
  if (payload && payload.users) {
    usersData = payload.users;
    taskCounts = payload.task_counts || null;
    sourceInfo = payload.source || '';
    updateSourceBadge(true);
  }
  renderLeaderboard();
}

function updateSourceBadge(ok) {
  const el = document.getElementById('source-badge');
  const label = ok
    ? (sourceInfo === 'google-sheet' ? 'live · google sheet' : 'live · ' + (sourceInfo || 'connected'))
    : 'offline — retrying…';
  el.className = 'source-badge' + (ok ? ' live' : ' offline');
  const dot = '<span class="live-dot"></span>';
  el.innerHTML = ok ? dot + escapeHtml(label) : escapeHtml(label);
}

async function loadFromBackend() {
  try {
    const csv = await LeaderboardScoring.loadSheetCSV();
    applyPayload(LeaderboardScoring.buildPayload(csv));
    showStatus('');
  } catch (err) {
    updateSourceBadge(false);
    showStatus('Offline — retrying… ' + escapeHtml(err.message), true);
  }
}


/* === ui rendering === */

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderLeaderboard() {
  const tbody = document.getElementById('leaderboard-body');
  const statusBar = document.getElementById('status-bar');

  const query = searchQuery.toLowerCase();
  const scored = {};

  Object.entries(usersData).forEach(([name, u]) => {
    const tasks = u.tasks.filter(t => withinRange(t, activeRange));
    const total = round(tasks.reduce((s, t) => s + t.weighted_points, 0));
    scored[name] = { name, grade: u.grade, website: u.website, tasks, total, count: tasks.length };
  });

  const order = Object.keys(scored).sort((a, b) => {
    const result = sortMode === 'tasks'
      ? scored[b].count - scored[a].count
      : scored[b].total - scored[a].total;
    return result || a.localeCompare(b);
  });

  const rankMap = {};
  if (gradeFilter === 'all') {
    order.forEach((name, i) => { rankMap[name] = i + 1; });
  } else {
    const gradeOrder = order.filter(name => scored[name].grade === gradeFilter);
    gradeOrder.forEach((name, i) => { rankMap[name] = i + 1; });
  }

  const display = order.filter(name => {
    const low = name.toLowerCase();
    return (!query || low.includes(query)) &&
           (gradeFilter === 'all' || scored[name].grade === gradeFilter);
  });

  if (display.length === 0) {
    statusBar.className = 'status-bar visible';
    statusBar.innerHTML = '<div class="empty-state">No data available for current filter.</div>';
    tbody.innerHTML = '';
    updateSummary(0, 0);
    return;
  }

  statusBar.className = 'status-bar';
  tbody.innerHTML = '';

  const table = document.getElementById('leaderboard');
  table.classList.remove('sort-points', 'sort-tasks');
  table.classList.add(sortMode === 'tasks' ? 'sort-tasks' : 'sort-points');

  display.forEach(name => {
    const rank = rankMap[name];
    const user = scored[name];
    const isExpanded = expandedUser === name;
    const medalClass = rank === 1 ? 'rank-gold' : rank === 2 ? 'rank-silver' : rank === 3 ? 'rank-bronze' : '';
    const badgeClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : 'plain';
    const rankIcon = rank === 1
      ? '<span class="crown">\u{1F451}</span>'
      : rank === 2
        ? '<span class="star">\u2605</span>'
        : rank === 3
          ? '<span class="star">\u2606</span>'
          : '';

    const mainRow = document.createElement('tr');
    mainRow.className = `data-row ${medalClass}`.trim();
    mainRow.innerHTML = `
      <td class="rank-cell"><span class="rank-badge ${badgeClass}">${rank}</span></td>
      <td>
        <div class="name-cell">
          <div class="name-primary">
            <span class="name-text">${escapeHtml(name)}</span>${rankIcon}
            <span class="grade-badge">Gr ${user.grade}</span>
          </div>
          ${user.website ? `<a href="${escapeHtml(user.website)}" target="_blank" rel="noopener" class="user-link">${escapeHtml(user.website)}</a>` : ''}
        </div>
      </td>
      <td class="tasks-cell">${user.count}</td>
      <td class="points-cell">${user.total}<span class="points-unit">PTS</span></td>
      <td class="actions-cell">
        <button class="expand-btn ${isExpanded ? 'active' : ''}" data-user="${escapeHtml(name)}" type="button">
          ${isExpanded ? '&#8722;' : '+'}
        </button>
      </td>
    `;
    tbody.appendChild(mainRow);

    const detailRow = document.createElement('tr');
    detailRow.className = 'detail-row';
    detailRow.innerHTML = `<td colspan="5"><div class="detail-content ${isExpanded ? 'open' : ''}"><div class="detail-inner"></div></div></td>`;
    tbody.appendChild(detailRow);

    if (isExpanded) {
      buildDetailContent(detailRow.querySelector('.detail-inner'), user.tasks);
    }
  });

  const totalTasks = taskCounts && taskCounts[activeRange] != null
    ? taskCounts[activeRange]
    : Object.values(scored).reduce((sum, u) => sum + u.count, 0);
  updateSummary(display.length, totalTasks);
}

function buildExtraReason(t) {
  const parts = [];
  const sp = Number(t.speed_points);
  if (sp > 0) parts.push(`speed +${sp} \u00b7 ${t.business_days} days`);
  else if (sp < 0) parts.push(`speed ${sp} \u00b7 ${t.business_days} days`);
  const gb = Number(t.grade_bonus);
  if (gb > 0) parts.push(`grade +${gb}`);
  return parts;
}

function buildDetailContent(container, tasks) {
  let html = `<table class="detail-table">
    <thead>
      <tr>
        <th>task name</th>
        <th>start date</th>
        <th>end date</th>
        <th>days taken</th>
        <th>base points</th>
        <th>extra points</th>
        <th>total points</th>
      </tr>
    </thead>
    <tbody>`;

  tasks.forEach(t => {
    const extra = round(t.weighted_points - t.base_points);
    const reasons = buildExtraReason(t);
    html += `
      <tr>
        <td class="detail-task-name">${escapeHtml(t.task)}</td>
        <td>${escapeHtml(t.start)}</td>
        <td>${escapeHtml(t.end)}</td>
        <td>${t.business_days}</td>
        <td>${t.base_points}</td>
        <td class="detail-extra">
          ${extra > 0 ? '+' : ''}${extra}
          <div class="detail-reason">${reasons.length ? escapeHtml(reasons.join(' · ')) : 'no extras'}</div>
        </td>
        <td class="detail-points">${t.weighted_points}</td>
      </tr>`;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

function updateSummary(personCount, taskCount) {
  const el = document.getElementById('summary-text');
  el.textContent = `${personCount} people \u00b7 ${taskCount} completed tasks \u00b7 ${activeRange === 'all' ? 'all time' : activeRange}`;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function showStatus(message, isError = false) {
  const el = document.getElementById('status-bar');
  el.className = 'status-bar visible' + (isError ? ' error' : '');
  el.innerHTML = message;
}

function toggleExpand(userName) {
  expandedUser = expandedUser === userName ? null : userName;
  renderLeaderboard();
}


/* === event handlers === */

function setupFilterButtons() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeRange = btn.dataset.range;
      expandedUser = null;
      renderLeaderboard();
    });
  });
}

function setupGradeButtons() {
  document.querySelectorAll('.grade-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.grade-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      gradeFilter = btn.dataset.grade === 'all' ? 'all' : Number(btn.dataset.grade);
      expandedUser = null;
      renderLeaderboard();
    });
  });
}

function setupSortButtons() {
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      sortMode = btn.dataset.sort;
      expandedUser = null;
      renderLeaderboard();
    });
  });
}

function setupSearch() {
  const input = document.getElementById('search-input');
  input.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderLeaderboard();
  });
}

function setupExpandDelegation() {
  document.getElementById('leaderboard-body').addEventListener('click', (e) => {
    const btn = e.target.closest('.expand-btn');
    if (btn) {
      toggleExpand(btn.dataset.user);
      return;
    }
    const cell = e.target.closest('.tasks-cell, .points-cell');
    if (cell) {
      const row = cell.closest('.data-row');
      if (row) {
        const expandBtn = row.querySelector('.expand-btn');
        if (expandBtn) toggleExpand(expandBtn.dataset.user);
      }
    }
  });
}


/* === initialization === */

document.addEventListener('DOMContentLoaded', async () => {
  setupFilterButtons();
  setupGradeButtons();
  setupSortButtons();
  setupSearch();
  setupExpandDelegation();

  await loadFromBackend();
  setInterval(loadFromBackend, REFRESH_MS);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadFromBackend();
  });
});