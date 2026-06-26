'use strict';

const config = require('../config');

const CAP = config.AUDIT_BUFFER_SIZE || 200;

const buffer = [];

function recordAudit(entry) {
  buffer.push(entry);
  if (buffer.length > CAP) {
    buffer.shift();
  }
}

function getAudit(limit) {
  let entries;
  if (limit === undefined) {
    entries = [...buffer];
  } else {
    const n = Math.min(limit, buffer.length);
    entries = buffer.slice(-n);
  }
  // Return newest-first
  return entries.reverse();
}

function resetAudit() {
  buffer.length = 0;
}

module.exports = { recordAudit, getAudit, resetAudit };
