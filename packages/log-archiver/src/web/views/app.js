/* Cubert Log Archiver — Vanilla JS Frontend */

const app = document.getElementById('app');
const breadcrumb = document.getElementById('breadcrumb');
const drawer = document.getElementById('drawer');
const drawerOverlay = document.getElementById('drawer-overlay');
const drawerTitle = document.getElementById('drawer-title');
const drawerBody = document.getElementById('drawer-body');
const topDrawer = document.getElementById('top-drawer');
const topDrawerTitle = document.getElementById('top-drawer-title');
const topDrawerBody = document.getElementById('top-drawer-body');

let currentView = 'batches';
let currentFilename = null;
let currentOffset = 0;
let currentBatchHasOts = false;
const PAGE_SIZE = 100;

// ── Navigation ──

function showBatches() {
  currentView = 'batches';
  currentFilename = null;
  breadcrumb.style.display = 'none';
  closeAllDrawers();
  loadBatches();
}

function showLogViewer(filename, hasOts) {
  currentView = 'logs';
  currentFilename = filename;
  currentBatchHasOts = !!hasOts;
  currentOffset = 0;
  breadcrumb.style.display = 'flex';
  breadcrumb.innerHTML =
    '<a onclick="showBatches()">Batches</a>' +
    '<span>/</span>' +
    '<span class="breadcrumb-filename">' + escapeHtml(filename) + '</span>' +
    (currentBatchHasOts
      ? '<a class="header-proof-chain" onclick="openTopDrawer(\'' + escapeAttr(filename) + '\')">Proof Chain</a>'
      : '');
  closeAllDrawers();
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
        '<td><a class="filename-link" onclick="showLogViewer(\'' + escapeAttr(b.filename) + '\', ' + !!b.otsAvailable + ')">' + escapeHtml(b.filename) + '</a></td>' +
        '<td>' + b.leafCount + '</td>' +
        '<td>' + size + '</td>' +
        '<td><span class="merkle-root" title="' + escapeAttr(b.merkleRoot) + '">' + rootShort + '</span></td>' +
        '<td class="actions">' +
          '<a href="/api/download/' + encodeURIComponent(b.filename) + '">Log</a>' +
          '<a href="/api/download/' + encodeURIComponent(b.filename) + '.tree">Tree</a>' +
          '<a href="/api/download/' + encodeURIComponent(b.filename) + '.root">Root</a>' +
          (b.otsAvailable ? '<a href="/api/download/' + encodeURIComponent(b.filename) + '.ots">OTS</a>' +
            '<a class="ots-details-link" onclick="openTopDrawer(\'' + escapeAttr(b.filename) + '\')">Proof Chain</a>' : '') +
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
  document.querySelectorAll('.log-line.selected').forEach(function(e) { e.classList.remove('selected'); });
  if (!topDrawer.classList.contains('open')) {
    drawerOverlay.classList.remove('open');
  }
}

function openTopDrawer(filename) {
  topDrawerTitle.textContent = 'Bitcoin Proof Chain — ' + filename;
  topDrawerBody.innerHTML = '<div class="proof-loading">Loading OTS proof chain...</div>';
  topDrawer.classList.add('open');
  drawerOverlay.classList.add('open');
  loadOtsDetails(filename);
}

function closeTopDrawer() {
  topDrawer.classList.remove('open');
  if (!drawer.classList.contains('open')) {
    drawerOverlay.classList.remove('open');
  }
}

function closeAllDrawers() {
  drawer.classList.remove('open');
  topDrawer.classList.remove('open');
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
      '<details class="proof-path-details">' +
      '<summary>Proof Path (' + data.proof.siblings.length + ' levels)</summary>' +
      '<div class="proof-value"><ul class="proof-path">';
    for (var i = 0; i < data.proof.siblings.length; i++) {
      var s = data.proof.siblings[i];
      html += '<li><span class="step-num">' + i + '</span><span class="direction">' + s.position + '</span><span>' + escapeHtml(s.hash) + '</span></li>';
    }
    html += '</ul></div></details></div>';

    html += '</div></div>';

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

function renderOtsStep(step) {
  var barClass = 'op';
  var opLabel = step.type;
  var valueHtml = '';

  if (step.type === 'append') {
    opLabel = 'append';
    if (step.computed) {
      valueHtml = '<span class="ots-hash-muted">' + escapeHtml(step.computed.before) + '</span>' +
        '<span class="ots-highlight">' + escapeHtml(step.computed.arg) + '</span>';
    } else {
      valueHtml = '<span class="ots-highlight">' + escapeHtml(step.detail) + '</span>';
    }
  } else if (step.type === 'prepend') {
    opLabel = 'prepend';
    if (step.computed) {
      valueHtml = '<span class="ots-highlight">' + escapeHtml(step.computed.arg) + '</span>' +
        '<span class="ots-hash-muted">' + escapeHtml(step.computed.before) + '</span>';
    } else {
      valueHtml = '<span class="ots-highlight">' + escapeHtml(step.detail) + '</span>';
    }
  } else if (step.type === 'sha256' || step.type === 'ripemd160' || step.type === 'sha1') {
    opLabel = step.type + '()';
    if (step.computed && step.computed.hash) {
      valueHtml = escapeHtml(step.computed.hash);
    } else {
      valueHtml = '<span class="ots-highlight-muted">hash current value</span>';
    }
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

  return '<div class="ots-step">' +
    '<div class="ots-step-bar ' + barClass + '"></div>' +
    '<div class="ots-step-op">' + escapeHtml(opLabel) + '</div>' +
    '<div class="ots-step-value">' + valueHtml + '</div>' +
    '</div>';
}

async function loadOtsDetails(filename) {
  try {
    var res = await fetch('/api/batches/' + encodeURIComponent(filename) + '/ots-info');
    var data = await res.json();

    // Split steps into shared stem (no path) and per-fork buckets
    var sharedSteps = [];
    var forks = {};  // path number -> array of steps
    for (var i = 0; i < data.steps.length; i++) {
      var step = data.steps[i];
      if (step.path === undefined || step.path === null || step.path === 0) {
        sharedSteps.push(step);
      } else {
        if (!forks[step.path]) forks[step.path] = [];
        forks[step.path].push(step);
      }
    }
    var forkKeys = Object.keys(forks).sort(function(a, b) { return a - b; });

    // Compute running hash values through the chain
    var lastSharedHash = await processChainValues(sharedSteps, data.fileHash);
    for (var f = 0; f < forkKeys.length; f++) {
      await processChainValues(forks[forkKeys[f]], lastSharedHash);
    }

    var html = '<div class="ots-chain">';

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

    // Shared stem
    for (var i = 0; i < sharedSteps.length; i++) {
      html += renderOtsStep(sharedSteps[i]);
    }

    // Fork columns
    if (forkKeys.length > 0) {
      html += '<div class="ots-fork-label">' +
        '<div class="ots-step-bar fork"></div>' +
        '<span>' + forkKeys.length + ' attestation path' + (forkKeys.length > 1 ? 's' : '') + '</span>' +
        '</div>';
      html += '<div class="ots-fork-columns" style="grid-template-columns: repeat(' + forkKeys.length + ', 1fr)">';
      for (var f = 0; f < forkKeys.length; f++) {
        var pathSteps = forks[forkKeys[f]];
        // Determine path type from last step
        var lastStep = pathSteps[pathSteps.length - 1];
        var pathType = lastStep.type === 'bitcoin' ? 'bitcoin' : (lastStep.type === 'pending' ? 'pending' : 'op');
        html += '<div class="ots-fork-col">';
        html += '<div class="ots-fork-col-header ' + pathType + '">Path ' + forkKeys[f] + '</div>';
        for (var s = 0; s < pathSteps.length; s++) {
          html += renderOtsStep(pathSteps[s]);
        }
        html += '</div>';
      }
      html += '</div>';
    }

    html += '</div>';
    topDrawerBody.innerHTML = html;
  } catch (err) {
    topDrawerBody.innerHTML = '<div class="proof-loading">Failed to load OTS details.</div>';
  }
}

// ── Crypto Helpers ──

function hexToBytes(hex) {
  var bytes = new Uint8Array(hex.length / 2);
  for (var i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

async function sha256Hex(hexStr) {
  var buf = await crypto.subtle.digest('SHA-256', hexToBytes(hexStr));
  return bytesToHex(new Uint8Array(buf));
}

async function processChainValues(steps, startHash) {
  var current = startHash;
  for (var i = 0; i < steps.length; i++) {
    var step = steps[i];
    if (!current) { step.computed = null; continue; }
    if (step.type === 'append') {
      step.computed = { before: current, arg: step.detail };
      current = current + step.detail;
    } else if (step.type === 'prepend') {
      step.computed = { before: current, arg: step.detail };
      current = step.detail + current;
    } else if (step.type === 'sha256') {
      current = await sha256Hex(current);
      step.computed = { hash: current };
    } else if (step.type === 'sha1') {
      try {
        var buf = await crypto.subtle.digest('SHA-1', hexToBytes(current));
        current = bytesToHex(new Uint8Array(buf));
        step.computed = { hash: current };
      } catch(e) { current = null; step.computed = null; }
    } else if (step.type === 'ripemd160') {
      current = null; step.computed = null;
    }
  }
  return current;
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
