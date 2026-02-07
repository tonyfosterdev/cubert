/* Cubert Log Archiver — Vanilla JS Frontend */

const app = document.getElementById('app');
const breadcrumb = document.getElementById('breadcrumb');

let currentView = 'batches';
let currentFilename = null;
let currentOffset = 0;
const PAGE_SIZE = 100;

// ── Navigation ──

function showBatches() {
  currentView = 'batches';
  currentFilename = null;
  breadcrumb.style.display = 'none';
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
          '<a href="/api/download/log/' + encodeURIComponent(b.filename) + '">Log</a>' +
          '<a href="/api/download/tree/' + encodeURIComponent(b.filename) + '">Tree</a>' +
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
        '<span class="line-content">' + formatLogContent(line.content) + '</span>' +
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

// ── Merkle Verification ──

async function verifyLine(lineNum, el) {
  // Highlight selected line
  document.querySelectorAll('.log-line.selected').forEach(function(e) { e.classList.remove('selected'); });
  el.classList.add('selected');

  // Collapse any other open proof panels
  document.querySelectorAll('.inline-proof').forEach(function(e) { e.remove(); });

  // Show loading inline below the clicked line
  var proofDiv = document.createElement('div');
  proofDiv.className = 'inline-proof';
  proofDiv.innerHTML = '<div class="proof-loading">Verifying...</div>';
  el.after(proofDiv);

  try {
    const res = await fetch('/api/batches/' + encodeURIComponent(currentFilename) + '/verify/' + lineNum);
    const data = await res.json();

    var html = '<div class="inline-proof-inner">';

    // Header with badge
    html += '<div class="proof-header">' +
      '<span class="proof-title">Merkle Proof for Line ' + (lineNum + 1) + '</span>' +
      '<span class="badge ' + (data.valid ? 'badge-valid' : 'badge-invalid') + '">' +
      (data.valid ? 'Valid' : 'Invalid') + '</span>' +
      '</div>';

    // Proof details in a compact grid
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

    // CLI snippet
    html += '<div class="proof-cell proof-cell-full">' +
      '<div class="proof-label">CLI Verification <button class="copy-btn" onclick="copySnippet(this, event)">Copy</button></div>' +
      '<pre class="cli-snippet">' + escapeHtml(buildCliSnippet(data)) + '</pre>' +
      '</div>';

    html += '</div></div>';

    proofDiv.innerHTML = html;
  } catch (err) {
    proofDiv.innerHTML = '<div class="inline-proof-inner"><div class="proof-loading">Verification failed.</div></div>';
  }
}

function buildCliSnippet(data) {
  var treeFilename = currentFilename.replace(/\.log$/, '.tree');
  var escapedLine = data.logEntry.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
  var treeUrl = window.location.origin + '/api/download/tree/' + encodeURIComponent(currentFilename);
  return "# From the project root (local tree file):\n" +
    "node packages/log-archiver/bin/verify.js /path/to/" + treeFilename + " '" + escapedLine + "'\n\n" +
    "# Or fetch the tree file over HTTP:\n" +
    "node packages/log-archiver/bin/verify.js " + treeUrl + " '" + escapedLine + "'";
}

function copySnippet(btn, evt) {
  evt.stopPropagation();
  var pre = btn.closest('.proof-cell').querySelector('.cli-snippet');
  navigator.clipboard.writeText(pre.textContent).then(function() {
    btn.textContent = 'Copied!';
    setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
  });
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

function formatLogContent(content) {
  try {
    var obj = JSON.parse(content);
    return escapeHtml(JSON.stringify(obj, null, 2));
  } catch (e) {
    return escapeHtml(content);
  }
}

// ── Init ──

showBatches();
