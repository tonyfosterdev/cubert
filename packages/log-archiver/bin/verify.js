#!/usr/bin/env node
'use strict';

const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');

// ── Helpers ──

function sha256(data) {
  return createHash('sha256').update(data).digest();
}

function hashPair(left, right) {
  return createHash('sha256').update(Buffer.concat([left, right])).digest();
}

function isUrl(str) {
  return str.startsWith('http://') || str.startsWith('https://');
}

function fetchUrl(url) {
  return new Promise(function (resolve, reject) {
    var mod = url.startsWith('https://') ? require('node:https') : require('node:http');
    mod.get(url, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error('HTTP ' + res.statusCode + ' fetching ' + url));
      }
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { resolve(Buffer.concat(chunks).toString('utf-8')); });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function loadTreeContent(source) {
  if (isUrl(source)) {
    return fetchUrl(source);
  }
  return Promise.resolve(readFileSync(source, 'utf-8'));
}

// ── Merkle tree rebuild & proof ──

function buildTree(leaves) {
  const levels = [leaves];
  let current = leaves;

  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i];
      const right = i + 1 < current.length ? current[i + 1] : current[i];
      next.push(hashPair(left, right));
    }
    levels.push(next);
    current = next;
  }

  return levels;
}

function getProof(levels, leafIndex) {
  const siblings = [];
  let idx = leafIndex;

  for (let level = 0; level < levels.length - 1; level++) {
    const layer = levels[level];
    const isLeft = idx % 2 === 0;
    const siblingIdx = isLeft ? idx + 1 : idx - 1;
    const sibling = siblingIdx < layer.length ? layer[siblingIdx] : layer[idx];

    siblings.push({
      hash: sibling.toString('hex'),
      position: isLeft ? 'right' : 'left',
    });

    idx = Math.floor(idx / 2);
  }

  return siblings;
}

function walkProof(leafHash, siblings) {
  let current = leafHash;

  for (const s of siblings) {
    const siblingBuf = Buffer.from(s.hash, 'hex');
    if (s.position === 'right') {
      current = hashPair(current, siblingBuf);
    } else {
      current = hashPair(siblingBuf, current);
    }
  }

  return current;
}

// ── Main ──

async function main() {
  const args = process.argv.slice(2);

  if (args.length !== 2) {
    console.error("Usage: node verify.js <tree-file-or-url> '<json-log-line>'");
    process.exit(1);
  }

  const [treeSource, logLine] = args;

  // 1. Hash the provided log line
  const leafHash = sha256(logLine);
  const leafHex = leafHash.toString('hex');

  // 2. Read .tree content (local file or URL)
  let treeContent;
  try {
    treeContent = await loadTreeContent(treeSource);
  } catch (err) {
    console.error('Error: cannot read tree source: ' + treeSource);
    console.error(err.message);
    process.exit(1);
  }

  const leafHexes = treeContent.trim().split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  const leafBuffers = leafHexes.map(function (hex) { return Buffer.from(hex, 'hex'); });

  if (leafBuffers.length === 0) {
    console.error('Error: tree file is empty');
    process.exit(1);
  }

  // 3. Find the leaf in the list
  const lineIndex = leafHexes.indexOf(leafHex);
  if (lineIndex === -1) {
    console.log('Leaf hash:  ' + leafHex);
    console.log('Status:     NOT FOUND');
    console.log('The log line does not match any leaf in the tree.');
    process.exit(1);
  }

  // 4. Rebuild the Merkle tree
  const levels = buildTree(leafBuffers);
  const root = levels[levels.length - 1][0];

  // 5. Generate proof path
  const siblings = getProof(levels, lineIndex);

  // 6. Walk the proof to recompute root
  const computedRoot = walkProof(leafHash, siblings);

  // 7. Print results
  const valid = computedRoot.equals(root);

  console.log('Leaf hash:    ' + leafHex);
  console.log('Line index:   ' + lineIndex);
  console.log('Proof path:');
  for (let i = 0; i < siblings.length; i++) {
    const s = siblings[i];
    console.log('  [' + i + '] ' + s.position.padEnd(5) + ' ' + s.hash);
  }
  console.log('Merkle root:  ' + root.toString('hex'));
  console.log('Computed:     ' + computedRoot.toString('hex'));
  console.log('Status:       ' + (valid ? 'VALID' : 'INVALID'));

  process.exit(valid ? 0 : 1);
}

main();
