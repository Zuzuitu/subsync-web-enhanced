'use strict';

function romanianConvergence(status) {
  return status
    && status.diagnostics
    && status.diagnostics.romanianConvergence
    ? status.diagnostics.romanianConvergence
    : null;
}

function isRomanianAdaptivePending(status) {
  const convergence = romanianConvergence(status);
  return Boolean(convergence && !convergence.verified);
}

function isSaveReady(status) {
  return Boolean(
    status
    && status.subReady
    && !isRomanianAdaptivePending(status)
  );
}

function canSaveInconclusive(status, settings) {
  if (!status || !settings || romanianConvergence(status)) {
    // A long Romanian adaptive run must never expose a weaker fallback save:
    // wait for the canonical adaptive lock or fail closed.
    return false;
  }

  return Boolean(
    status.points > settings.minPointsNo / 2
    && status.factor > Math.pow(settings.minCorrelation, 10)
    && status.maxDistance < 2 * settings.maxPointDist
  );
}

module.exports = {
  romanianConvergence,
  isRomanianAdaptivePending,
  isSaveReady,
  canSaveInconclusive,
};
