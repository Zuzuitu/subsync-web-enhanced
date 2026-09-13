'use strict';

function selectCanonicalStatus(current, candidate) {
  current = current || {};
  if (!candidate) return current;

  if (candidate.correlated || !current.correlated) {
    return candidate;
  }

  return current;
}

module.exports = { selectCanonicalStatus };
