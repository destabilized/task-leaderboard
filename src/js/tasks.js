/* tasks page — lists every task on the sheet, newest claims first.
   Unfinished tasks stay on top; completed tasks sink to the bottom greyed out.

   Claiming / completing calls a Google Apps Script Web App (see
   apps-script/Code.gs). Successful writes are confirmed by re-reading the
   sheet rather than trusting the response, so it works even with CORS. */

(function () {
  'use strict';

  var REFRESH_MS = 5000;
  var RECLAIM_AFTER_DAYS = 10;
  var CONFIRM_TIMEOUT_MS = 20000;
  var PENDING_POLL_MS = 1500;

  // Paste the deployed Apps Script Web App URL here:
  var TASKS_API_URL = 'https://script.google.com/macros/s/AKfycbwSTWNJKR9WUfOueXBYzNnP2-o-S2NOO4HFmxa_ko98xkjn5PQ7qtPkLLH8S4xlUTxMoA/exec';

  var pending = null;
  var modalCtx = null;
  var modalClosable = true;

  /* === helpers === */

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function findByTask(list, task) {
    return list.filter(function (t) { return t.task === task; });
  }

  /* === modal === */

  function setModal(html, closable) {
    modalClosable = closable !== false;
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal-close').style.display = modalClosable ? '' : 'none';
    document.getElementById('modal-overlay').classList.add('open');
    document.body.classList.add('modal-open');
  }

  function closeModal() {
    if (!modalClosable) return;
    document.getElementById('modal-overlay').classList.remove('open');
    document.body.classList.remove('modal-open');
    modalCtx = null;
    pending = null;
  }

  function showSaving() {
    setModal(
      '<h2 class="modal-title">Saving\u2026</h2>' +
      '<p class="modal-text">Recording your update to the sheet.</p>' +
      '<div class="modal-spinner"></div>',
      false
    );
  }

  function showConfirm(detail) {
    setModal(
      '<h2 class="modal-title">All set!</h2>' +
      '<p class="modal-text">' + detail + '</p>' +
      '<div class="modal-actions">' +
        '<button type="button" class="modal-btn primary" data-modal="close">done</button>' +
      '</div>',
      true
    );
  }

  function showError(message) {
    setModal(
      '<h2 class="modal-title">Hmm, that didn\'t work</h2>' +
      '<p class="modal-text">' + escapeHtml(message) + '</p>' +
      '<div class="modal-actions">' +
        '<button type="button" class="modal-btn primary" data-modal="close">close</button>' +
      '</div>',
      true
    );
  }

  function openClaim(action, task) {
    var verb = action === 'reclaim' ? 'Reclaim' : 'Claim';
    modalCtx = { action: action, task: task, name: '' };
    setModal(
      '<h2 class="modal-title">' + verb + ' task</h2>' +
      '<p class="modal-text">' + escapeHtml(task) + '</p>' +
      '<form id="modal-form" class="modal-form">' +
        '<label class="modal-label" for="modal-name">your name</label>' +
        '<input id="modal-name" class="modal-input" type="text" autocomplete="off" required>' +
        '<div class="modal-actions">' +
          '<button type="button" class="modal-btn ghost" data-modal="cancel">cancel</button>' +
          '<button type="submit" class="modal-btn primary">' + verb.toLowerCase() + '</button>' +
        '</div>' +
      '</form>',
      true
    );

    var form = document.getElementById('modal-form');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var name = document.getElementById('modal-name').value.trim();
      if (name) startAction(action, task, name);
    });
    document.getElementById('modal-name').focus();
  }

  function openDone(task, name) {
    modalCtx = { action: 'done', task: task, name: name };
    setModal(
      '<h2 class="modal-title">Mark as done?</h2>' +
      '<p class="modal-text">' + escapeHtml(task) +
        (name ? ' \u2014 claimed by ' + escapeHtml(name) : '') + '</p>' +
      '<div class="modal-actions">' +
        '<button type="button" class="modal-btn ghost" data-modal="cancel">cancel</button>' +
        '<button type="button" class="modal-btn primary" data-modal="submit">mark done</button>' +
      '</div>',
      true
    );
  }

  /* === backend === */

  function postAction(payload) {
    if (!TASKS_API_URL) return;
    try {
      fetch(TASKS_API_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
    } catch (err) { /* fire and forget — confirmation comes from the sheet */ }
  }

  function startAction(action, task, name) {
    if (!TASKS_API_URL) {
      showError('Claiming isn\'t connected yet. Add your Apps Script Web App URL to TASKS_API_URL in src/js/tasks.js.');
      return;
    }
    postAction({ action: action, task: task, name: name });
    pending = { action: action, task: task, name: name, startedAt: Date.now() };
    showSaving();
    load().then(schedulePendingPoll);
  }

  function schedulePendingPoll() {
    if (!pending) return;
    setTimeout(function () {
      if (pending) load().then(schedulePendingPoll);
    }, PENDING_POLL_MS);
  }

  function checkPending(list) {
    if (!pending) return;

    var matches = findByTask(list, pending.task);

    if (pending.action === 'claim' || pending.action === 'reclaim') {
      var wantName = LeaderboardScoring.normalizeName(pending.name).toLowerCase();
      var claimed = matches.filter(function (t) {
        return !t.completed && t.name &&
          LeaderboardScoring.normalizeName(t.name).toLowerCase() === wantName &&
          t.days_claimed === 0;
      })[0];
      if (claimed) {
        pending = null;
        showConfirm('Recorded <strong>' + escapeHtml(claimed.name) +
          '</strong> \u00b7 start ' + escapeHtml(claimed.start) + '.');
        return;
      }
    } else if (pending.action === 'done') {
      var finished = matches.filter(function (t) { return t.completed; })[0];
      if (finished) {
        pending = null;
        showConfirm('Recorded completion on <strong>' + escapeHtml(finished.end) + '</strong>.');
        return;
      }
    }

    if (Date.now() - pending.startedAt > CONFIRM_TIMEOUT_MS) {
      pending = null;
      showError('The sheet didn\'t show the change in time. Check the sheet, then try again.');
    }
  }

  /* === table === */

  function sortTasks(list) {
    var active = list.filter(function (t) { return !t.completed; });
    var done = list.filter(function (t) { return t.completed; });

    active.sort(function (a, b) {
      var da = a.days_claimed == null ? -1 : a.days_claimed;
      var db = b.days_claimed == null ? -1 : b.days_claimed;
      return db - da || a.task.localeCompare(b.task);
    });

    done.sort(function (a, b) {
      return (b.end || '').localeCompare(a.end || '') || a.task.localeCompare(b.task);
    });

    return { active: active, done: done };
  }

  function buildRow(t, completed) {
    var tr = document.createElement('tr');
    tr.className = 'task-row' + (completed ? ' completed' : '');

    var claimant;
    if (t.name) {
      claimant = escapeHtml(t.name);
    } else {
      claimant = '<button type="button" class="task-action claim-btn" data-action="claim" ' +
        'data-task="' + escapeAttr(t.task) + '">claim</button>';
    }

    var days;
    if (completed) {
      days = '<span class="task-done-tag">done</span>';
    } else if (t.days_claimed == null) {
      days = '<span class="muted-dash">&mdash;</span>';
    } else {
      days = '<span class="days-num">' + t.days_claimed + '</span>' +
             '<span class="days-unit">' + (t.days_claimed === 1 ? 'day' : 'days') + '</span>';
      if (t.days_claimed > RECLAIM_AFTER_DAYS) {
        days += '<button type="button" class="task-action reclaim-btn" data-action="reclaim" ' +
          'data-task="' + escapeAttr(t.task) + '">reclaim</button>';
      }
    }

    var actions = '';
    if (!completed && t.name) {
      actions = '<button type="button" class="task-action done-btn" data-action="done" ' +
        'data-task="' + escapeAttr(t.task) + '" data-name="' + escapeAttr(t.name) + '">done?</button>';
    }

    tr.innerHTML =
      '<td class="task-name-cell">' + escapeHtml(t.task) +
        (t.start ? '<div class="task-date">claimed ' + escapeHtml(t.start) + '</div>' : '') +
      '</td>' +
      '<td class="claimant-cell">' + claimant + '</td>' +
      '<td class="days-cell">' + days + '</td>' +
      '<td class="task-points-cell">' + (t.points == null ? '' : t.points) + '</td>' +
      '<td class="actions-cell">' + actions + '</td>';

    return tr;
  }

  function render(list) {
    var tbody = document.getElementById('task-body');
    var statusBar = document.getElementById('status-bar');
    var summary = document.getElementById('tasks-summary');

    if (!list.length) {
      statusBar.className = 'status-bar visible';
      statusBar.innerHTML = '<div class="empty-state">No tasks found.</div>';
      tbody.innerHTML = '';
      summary.textContent = '';
      return;
    }

    statusBar.className = 'status-bar';
    tbody.innerHTML = '';

    var groups = sortTasks(list);

    groups.active.forEach(function (t) { tbody.appendChild(buildRow(t, false)); });

    if (groups.done.length) {
      var divider = document.createElement('tr');
      divider.className = 'task-divider';
      divider.innerHTML = '<td colspan="5">completed</td>';
      tbody.appendChild(divider);
      groups.done.forEach(function (t) { tbody.appendChild(buildRow(t, true)); });
    }

    summary.textContent =
      groups.active.length + ' active \u00b7 ' + groups.done.length + ' completed \u00b7 ' +
      list.length + ' total';
  }

  function setBadge(ok) {
    var badge = document.getElementById('source-badge');
    badge.className = 'source-badge' + (ok ? ' live' : ' offline');
    badge.innerHTML = ok
      ? '<span class="live-dot"></span>live \u00b7 google sheet'
      : 'offline — retrying…';
  }

  async function load() {
    var statusBar = document.getElementById('status-bar');
    try {
      var csv = await LeaderboardScoring.loadSheetCSV();
      var list = LeaderboardScoring.listAllTasks(LeaderboardScoring.parseCsv(csv));
      render(list);
      checkPending(list);
      setBadge(true);
    } catch (err) {
      statusBar.className = 'status-bar visible error';
      statusBar.textContent = 'Offline — retrying… ' + err.message;
      setBadge(false);
    }
  }

  /* === wiring === */

  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('task-body').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      var task = btn.dataset.task;
      if (action === 'claim') openClaim('claim', task);
      else if (action === 'reclaim') openClaim('reclaim', task);
      else if (action === 'done') openDone(task, btn.dataset.name);
    });

    document.getElementById('modal-close').addEventListener('click', closeModal);

    document.getElementById('modal-body').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-modal]');
      if (!btn) return;
      var act = btn.dataset.modal;
      if (act === 'cancel' || act === 'close') closeModal();
      else if (act === 'submit' && modalCtx) startAction(modalCtx.action, modalCtx.task, modalCtx.name);
    });

    document.getElementById('modal-overlay').addEventListener('click', function (e) {
      if (e.target === this) closeModal();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
    });

    load();
    setInterval(load, REFRESH_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) load();
    });
  });
})();
