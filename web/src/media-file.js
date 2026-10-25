'use strict';

const CHUNK_BYTES = 1024 * 1024;
const RESERVE_BYTES = 64 * 1024 * 1024;
const CACHE_DIRECTORY = 'subsync2-read-recovery';

function isContainerOpenError(error) {
  return error && String(error.module || '') === 'Demux.avformat_open_input'
    && (error.averror === 'AVERROR_INVALIDDATA' || Number(error.code) === -1094995529);
}

async function readExact(file, start, end) {
  const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
  if (bytes.length !== end - start) {
    throw new Error('The file could not be read completely. Download it in Files and select it again.');
  }
  return bytes;
}

async function isMp4(file) {
  if (!Number.isSafeInteger(file.size) || file.size < 12) return false;
  const header = await readExact(file, 0, 12);
  return String.fromCharCode(...header.subarray(4, 8)) === 'ftyp';
}

// The normal path remains File -> WORKERFS, without a whole-file RAM copy.
// On an MP4 container-open failure, retry once from a byte-verified browser-local
// file. This separates a file-provider/FileReaderSync problem from a bad codec or
// corrupt container; it does not make a corrupt MP4 pass FFmpeg's validation.
async function makeLocalCopy(file, options) {
  const { storage, crypto, File: FileType, isCurrent } = options;
  if (!storage || !storage.getDirectory || !crypto || !crypto.subtle) {
    throw new Error('A verified local copy is unavailable. Download the file in Files and select it again.');
  }
  if (storage.estimate) {
    const { quota, usage } = await storage.estimate();
    if (Number.isFinite(quota) && Number.isFinite(usage)
        && quota - usage < file.size + RESERVE_BYTES) {
      throw new Error('Not enough browser storage for a local copy of this file.');
    }
  }
  const root = await storage.getDirectory();
  const directory = await root.getDirectoryHandle(CACHE_DIRECTORY, { create: true });
  // Only abandoned copies older than a week are collected; active imports in
  // other tabs are left alone. Normal replacement/failure releases immediately.
  if (directory.entries) {
    for await (const [key, entry] of directory.entries()) {
      if (entry.kind !== 'file' || !key.startsWith('read-')) continue;
      try {
        if (Date.now() - (await entry.getFile()).lastModified > 7 * 86400000) {
          await directory.removeEntry(key);
        }
      } catch (_) { /* another tab may have released its copy */ }
    }
  }
  const suffix = /\.[a-z0-9]{1,10}$/i.exec(file.name || '');
  const name = 'read-' + crypto.randomUUID() + (suffix ? suffix[0] : '.mp4');
  const handle = await directory.getFileHandle(name, { create: true });
  let writer;
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await directory.removeEntry(name).catch(() => {});
  };
  const checkCurrent = () => {
    if (isCurrent && !isCurrent()) throw new Error('File selection changed.');
  };
  try {
    if (typeof handle.createWritable !== 'function') {
      throw new Error('A verified local copy is unavailable. Download the file in Files and select it again.');
    }
    writer = await handle.createWritable();
    const hashes = [];
    for (let start = 0; start < file.size; start += CHUNK_BYTES) {
      checkCurrent();
      const bytes = await readExact(file, start, Math.min(start + CHUNK_BYTES, file.size));
      hashes.push(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
      await writer.write(bytes);
    }
    await writer.close();
    writer = null;
    const snapshot = await handle.getFile();
    if (snapshot.size !== file.size) throw new Error('The local file copy did not pass verification.');
    for (let start = 0, index = 0; start < file.size; start += CHUNK_BYTES, index++) {
      checkCurrent();
      const bytes = await readExact(snapshot, start, Math.min(start + CHUNK_BYTES, file.size));
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      if (!digest.every((byte, i) => byte === hashes[index][i])) {
        throw new Error('The local file copy did not pass verification.');
      }
    }
    checkCurrent();
    return {
      file: new FileType([snapshot], file.name, { type: file.type, lastModified: file.lastModified }),
      release,
    };
  } catch (error) {
    if (writer) await writer.abort().catch(() => {});
    await release();
    throw error;
  }
}

async function inspectMediaFile(file, inspect, overrides = {}) {
  try {
    return { file, info: await inspect(file), release: async () => {}, recovered: false };
  } catch (original) {
    if (!isContainerOpenError(original)) throw original;
    let local;
    try {
      if (!await isMp4(file)) throw original;
      if (overrides.onRecovery) overrides.onRecovery();
      const options = {
        storage: typeof navigator !== 'undefined' ? navigator.storage : null,
        crypto: globalThis.crypto,
        File: globalThis.File,
        ...overrides,
      };
      local = await makeLocalCopy(file, options);
      const info = await inspect(local.file);
      return { ...local, info, recovered: true };
    } catch (recovery) {
      if (local) await local.release();
      if (recovery === original) throw original;
      // Keep the original native module/code/message, even if the local retry
      // also fails. A recovery attempt is evidence, not a root-cause verdict.
      throw Object.assign({}, original, {
        message: original.message,
        localReadRecovery: {
          attempted: true,
          message: recovery.message || String(recovery),
          module: recovery.module || null,
          code: recovery.code || null,
        },
      });
    }
  }
}

module.exports = { inspectMediaFile };
