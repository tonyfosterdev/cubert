/* Cubert Log Archiver — Vanilla JS Frontend */

const app = document.getElementById('app');
const breadcrumb = document.getElementById('breadcrumb');
const drawer = document.getElementById('drawer');
const drawerOverlay = document.getElementById('drawer-overlay');
const drawerTitle = document.getElementById('drawer-title');
const drawerBody = document.getElementById('drawer-body');

let currentView = 'batches';
let currentFilename = null;
let currentOffset = 0;
const PAGE_SIZE = 100;

// ── Navigation ──

function showBatches() {
  currentView = 'batches';
  currentFilename = null;
  breadcrumb.style.display = 'none';
  closeDrawer();
  loadBatches();
}

function showLogViewer(filename) {
  currentView = 'logs';
  currentFilename = filename;
  currentOffset = 0;
  breadcrumb.style.display = 'flex';
  breadcrumb.innerHTML =
    '<a onclick="showBatches()">Batches</a>' +
    '<span>/</span>' +
    '<span>' + escapeHtml(filename) + '</span>';
  closeDrawer();
  loadLogLines();
}

// ── Batch List ──

async function loadBatches() {
  app.innerHTML = '<div class="loading">Loading batches...</div>';

  try {
    const res = await fetch('/api/batches');
    const batches = await res.json();

    if (batches.length === 0) {
      app.innerHTML = '<div class="empty">No log batches yet. Waiting for first log rotation...</div>';
      return;
    }

    let html = '<table><thead><tr>' +
      '<th>Processed</th>' +
      '<th>Filename</th>' +
      '<th>Lines</th>' +
      '<th>Size</th>' +
      '<th>Merkle Root</th>' +
      '<th>Actions</th>' +
      '</tr></thead><tbody>';

    for (const b of batches) {
      const time = new Date(b.processedAt).toLocaleString();
      const size = formatBytes(b.fileSize);
      const rootShort = b.merkleRoot.substring(0, 16) + '...';

      html += '<tr>' +
        '<td>' + escapeHtml(time) + '</td>' +
        '<td><a class="filename-link" onclick="showLogViewer(\'' + escapeAttr(b.filename) + '\')">' + escapeHtml(b.filename) + '</a></td>' +
        '<td>' + b.leafCount + '</td>' +
        '<td>' + size + '</td>' +
        '<td><span class="merkle-root" title="' + escapeAttr(b.merkleRoot) + '">' + rootShort + '</span></td>' +
        '<td class="actions">' +
          '<a href="/api/download/' + encodeURIComponent(b.filename) + '">Log</a>' +
          '<a href="/api/download/' + encodeURIComponent(b.filename) + '.tree">Tree</a>' +
          '<a href="/api/download/' + encodeURIComponent(b.filename) + '.root">Root</a>' +
          (b.otsAvailable ? '<a href="/api/download/' + encodeURIComponent(b.filename) + '.ots">OTS</a>' : '') +
        '</td>' +
        '</tr>';
    }

    html += '</tbody></table>';
    app.innerHTML = html;
  } catch (err) {
    app.innerHTML = '<div class="empty">Failed to load batches.</div>';
  }
}

// ── Log Viewer ──

async function loadLogLines() {
  app.innerHTML = '<div class="loading">Loading log lines...</div>';

  try {
    const res = await fetch('/api/batches/' + encodeURIComponent(currentFilename) + '/lines?offset=' + currentOffset + '&limit=' + PAGE_SIZE);
    const data = await res.json();

    let html = '<div class="log-lines">';
    for (const line of data.lines) {
      html += '<div class="log-line" data-linenum="' + line.lineNum + '" onclick="verifyLine(' + line.lineNum + ', this)">' +
        '<span class="line-num">' + (line.lineNum + 1) + '</span>' +
        '<span class="line-content">' + escapeHtml(line.content) + '</span>' +
        '</div>';
    }
    html += '</div>';

    // Pagination
    html += '<div class="pagination">';
    html += '<button onclick="prevPage()" ' + (currentOffset === 0 ? 'disabled' : '') + '>Previous</button>';
    html += '<span>Lines ' + (currentOffset + 1) + ' - ' + (currentOffset + data.lines.length) + '</span>';
    html += '<button onclick="nextPage()" ' + (data.lines.length < PAGE_SIZE ? 'disabled' : '') + '>Next</button>';
    html += '</div>';

    app.innerHTML = html;
  } catch (err) {
    app.innerHTML = '<div class="empty">Failed to load log lines.</div>';
  }
}

function prevPage() {
  currentOffset = Math.max(0, currentOffset - PAGE_SIZE);
  loadLogLines();
}

function nextPage() {
  currentOffset += PAGE_SIZE;
  loadLogLines();
}

// ── Drawer ──

function openDrawer() {
  drawer.classList.add('open');
  drawerOverlay.classList.add('open');
}

function closeDrawer() {
  drawer.classList.remove('open');
  drawerOverlay.classList.remove('open');
  document.querySelectorAll('.log-line.selected').forEach(function(e) { e.classList.remove('selected'); });
}

// ── Merkle Verification (opens drawer) ──

async function verifyLine(lineNum, el) {
  // Highlight selected line
  document.querySelectorAll('.log-line.selected').forEach(function(e) { e.classList.remove('selected'); });
  el.classList.add('selected');

  // Open drawer with loading state
  drawerTitle.textContent = 'Line ' + (lineNum + 1);
  drawerBody.innerHTML = '<div class="proof-loading">Verifying...</div>';
  openDrawer();

  try {
    const res = await fetch('/api/batches/' + encodeURIComponent(currentFilename) + '/verify/' + lineNum);
    const data = await res.json();

    var html = '';

    // ── Log Entry ──
    html += '<div class="drawer-section">' +
      '<div class="drawer-section-title">Log Entry</div>' +
      '<pre class="code-block">' + formatLogJson(data.logEntry) + '</pre>' +
      '</div>';

    // ── Merkle Proof ──
    html += '<div class="drawer-section">' +
      '<div class="drawer-section-title">Merkle Proof ' +
      '<span class="badge ' + (data.valid ? 'badge-valid' : 'badge-invalid') + '">' +
      (data.valid ? 'Valid' : 'Invalid') + '</span></div>';

    html += '<div class="proof-grid">';

    html += '<div class="proof-cell">' +
      '<div class="proof-label">Leaf Hash</div>' +
      '<div class="proof-value">' + escapeHtml(data.leafHash) + '</div>' +
      '</div>';

    html += '<div class="proof-cell">' +
      '<div class="proof-label">Merkle Root</div>' +
      '<div class="proof-value">' + escapeHtml(data.storedMerkleRoot) + '</div>' +
      '</div>';

    html += '<div class="proof-cell proof-cell-full">' +
      '<div class="proof-label">Proof Path (' + data.proof.siblings.length + ' levels)</div>' +
      '<div class="proof-value"><ul class="proof-path">';
    for (var i = 0; i < data.proof.siblings.length; i++) {
      var s = data.proof.siblings[i];
      html += '<li><span class="step-num">' + i + '</span><span class="direction">' + s.position + '</span><span>' + escapeHtml(s.hash) + '</span></li>';
    }
    html += '</ul></div></div>';

    html += '</div></div>';

    // ── OTS Status ──
    if (data.ots) {
      html += '<div class="drawer-section">' +
        '<div class="drawer-section-title">Bitcoin Timestamp ' +
        '<a class="ots-details-link" onclick="loadOtsDetails(event)">View Proof Chain</a></div>';
      if (data.ots.status === 'verified') {
        html += '<div class="proof-value ots-verified">' +
          'Verified at block <a href="' + escapeAttr(data.ots.explorerUrl) + '" target="_blank">#' + data.ots.bitcoinHeight + '</a>' +
          ' (' + escapeHtml(data.ots.bitcoinTimestamp) + ')' +
          '</div>';
      } else {
        html += '<div class="proof-value ots-pending">Pending confirmation</div>';
      }
      html += '<div id="ots-details-container"></div>';
      html += '</div>';
    }

    // ── CLI Command ──
    html += '<div class="drawer-section">' +
      '<div class="drawer-section-title">CLI Verification <button class="copy-btn" onclick="copySnippet(this, event)">Copy</button></div>' +
      '<pre class="cli-snippet">' + escapeHtml(buildCliSnippet(data)) + '</pre>' +
      '</div>';

    drawerBody.innerHTML = html;
  } catch (err) {
    drawerBody.innerHTML = '<div class="proof-loading">Verification failed.</div>';
  }
}

function buildCliSnippet(data) {
  var escapedLine = data.logEntry.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
  var batchUrl = window.location.origin + '/api/download/' + encodeURIComponent(currentFilename);
  return "node packages/log-archiver/bin/verify.js " + batchUrl + " '" + escapedLine + "'";
}

function copySnippet(btn, evt) {
  evt.stopPropagation();
  var pre = btn.closest('.drawer-section').querySelector('.cli-snippet');
  navigator.clipboard.writeText(pre.textContent).then(function() {
    btn.textContent = 'Copied!';
    setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
  });
}

// ── OTS Proof Chain ──

async function loadOtsDetails(evt) {
  evt.preventDefault();
  var container = document.getElementById('ots-details-container');
  if (!container) return;

  // Toggle: if already loaded, remove it
  if (container.innerHTML) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '<div class="proof-loading">Loading OTS proof chain...</div>';

  try {
    var res = await fetch('/api/batches/' + encodeURIComponent(currentFilename) + '/ots-info');
    var data = await res.json();

    var html = '<div class="ots-chain" style="margin-top:10px">';

    // Header with file hash
    html += '<div class="ots-header">' +
      '<div class="ots-header-label">Document digest (sha256)</div>' +
      '<div class="ots-header-hash">' + escapeHtml(data.fileHash) + '</div>' +
      '</div>';

    // Legend
    html += '<div class="ots-legend">' +
      '<span class="ots-legend-item"><span class="ots-legend-dot bitcoin"></span> Bitcoin</span>' +
      '<span class="ots-legend-item"><span class="ots-legend-dot pending"></span> Pending</span>' +
      '<span class="ots-legend-item"><span class="ots-legend-dot fork"></span> Fork</span>' +
      '<span class="ots-legend-item"><span class="ots-legend-dot op"></span> Operation</span>' +
      '</div>';

    // Steps
    var prevPath = 0;
    for (var i = 0; i < data.steps.length; i++) {
      var step = data.steps[i];

      // Show fork separator when path changes
      if (step.path && step.path !== prevPath) {
        html += '<div class="ots-step">' +
          '<div class="ots-step-bar fork"></div>' +
          '<div class="ots-step-op" style="color:var(--accent)">Fork</div>' +
          '<div class="ots-step-value" style="color:var(--accent)">Path ' + step.path + '</div>' +
          '</div>';
        prevPath = step.path;
      }

      var barClass = 'op';
      var opLabel = step.type;
      var valueHtml = '';

      if (step.type === 'append') {
        opLabel = 'append';
        valueHtml = '<span class="ots-highlight">' + escapeHtml(step.detail) + '</span>';
      } else if (step.type === 'prepend') {
        opLabel = 'prepend';
        valueHtml = '<span class="ots-highlight">' + escapeHtml(step.detail) + '</span>';
      } else if (step.type === 'sha256' || step.type === 'ripemd160' || step.type === 'sha1') {
        opLabel = step.type + '()';
        valueHtml = '';
      } else if (step.type === 'pending') {
        barClass = 'pending';
        opLabel = 'verify';
        valueHtml = '<span class="ots-highlight-pending">PendingAttestation</span> ' +
          '<a href="' + escapeAttr(step.detail) + '" target="_blank">' + escapeHtml(step.detail) + '</a>';
      } else if (step.type === 'bitcoin') {
        barClass = 'bitcoin';
        opLabel = 'verify';
        valueHtml = '<span class="ots-highlight">BitcoinBlockHeader</span> block ' +
          '<a href="https://blockstream.info/block-height/' + escapeAttr(step.detail) + '" target="_blank">#' + escapeHtml(step.detail) + '</a>';
      } else {
        valueHtml = escapeHtml(step.detail);
      }

      html += '<div class="ots-step">' +
        '<div class="ots-step-bar ' + barClass + '"></div>' +
        '<div class="ots-step-op">' + escapeHtml(opLabel) + '</div>' +
        '<div class="ots-step-value">' + valueHtml + '</div>' +
        '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div class="proof-loading">Failed to load OTS details.</div>';
  }
}

// ── Helpers ──

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  var k = 1024;
  var sizes = ['B', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function escapeHtml(str) {
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function formatLogJson(content) {
  try {
    var obj = JSON.parse(content);
    return escapeHtml(JSON.stringify(obj, null, 2));
  } catch (e) {
    return escapeHtml(content);
  }
}

// ── Init ──

showBatches();
