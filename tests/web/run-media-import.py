#!/usr/bin/env python3
"""Real PWA File/WORKERFS import + read-fault recovery; no speech model/network media.

The default MP4 is generated from tones, one color frame and one chapter. Optional
--input is for a local private reproduction only; never upload that media to CI.
"""
import argparse
import functools
import http.server
import json
import shutil
import ssl
import subprocess
import tempfile
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--browser', choices=['chromium', 'webkit'], default='chromium')
parser.add_argument('--dist', type=Path, default=ROOT / 'web/dist')
parser.add_argument('--input', type=Path)
args = parser.parse_args()
OUT = ROOT / 'tests/generated/media-import'
OUT.mkdir(parents=True, exist_ok=True)
if args.input:
    source = args.input.resolve()
else:
    source = OUT / 'audio cover chapters.mp4'
    def run(*command):
        subprocess.run(command, check=True, capture_output=True)
    run('ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i',
        'aevalsrc=0.08*sin(2*PI*440*t)|0.08*sin(2*PI*550*t)|0.08*sin(2*PI*660*t)|0.08*sin(2*PI*110*t)|0.08*sin(2*PI*330*t)|0.08*sin(2*PI*220*t):s=48000:d=12',
        '-c:a', 'aac', '-b:a', '384k', str(OUT / 'tones.m4a'))
    run('ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=64x64:r=25',
        '-frames:v', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv444p', str(OUT / 'cover.mp4'))
    chapter = OUT / 'chapters.txt'
    chapter.write_text(';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=Chapter 1\n')
    run('ffmpeg', '-y', '-v', 'error', '-i', str(OUT / 'tones.m4a'), '-i', str(OUT / 'cover.mp4'),
        '-i', str(chapter), '-map', '0:a:0', '-map', '1:v:0', '-map_chapters', '2',
        '-c', 'copy', '-metadata:s:a:0', 'language=ita', str(source))
assert source.is_file()

# Inject a read failure in the synchronous worker FileReaderSync path for only
# the first MP4 File object. Main-thread asynchronous source reads stay intact.
# This reproduces AVERROR_INVALIDDATA without changing the original file/codec.
FAULT_SCRIPT = r'''() => {
 const OriginalWorker = window.Worker;
 window.Worker = class extends OriginalWorker {
  constructor(url, options) {
   if (!String(url).startsWith('blob:')) { super(url, options); return; }
   const prefix = `
    const sourceSlice = File.prototype.slice;
    const sourceRead = FileReaderSync.prototype.readAsArrayBuffer;
    const faultyBlobs = new WeakSet();
    let firstFile, reported = false;
    File.prototype.slice = function(...args) {
      const blob = sourceSlice.apply(this, args);
      if (/\\.mp4$/i.test(this.name)) {
        if (!firstFile) firstFile = this;
        if (this === firstFile) faultyBlobs.add(blob);
      }
      return blob;
    };
    FileReaderSync.prototype.readAsArrayBuffer = function(blob) {
      if (faultyBlobs.has(blob)) {
        if (!reported) { reported = true; self.postMessage({readFaultInjected: true}); }
        return new ArrayBuffer(blob.size);
      }
      return sourceRead.call(this, blob);
    };
   `;
   const wrapper = URL.createObjectURL(new Blob([prefix, 'importScripts(' + JSON.stringify(String(url)) + ');'], {type:'text/javascript'}));
   super(wrapper, options);
   this.addEventListener('message', event => {
     if (event.data && event.data.readFaultInjected) window.__readFaultInjected = true;
   });
   this.addEventListener('error', () => URL.revokeObjectURL(wrapper), {once:true});
  }
 };
}'''

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(args.dist.resolve())))
# WebKit exposes storage/crypto APIs only in a trustworthy context. Use local
# TLS, as the deployed PWA does, rather than weakening the recovery test or
# accepting an HTTP-loopback run with navigator.storage missing.
certificate_dir = tempfile.TemporaryDirectory(prefix='subsync-media-import-tls-')
certificate = Path(certificate_dir.name)
subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                '-keyout', str(certificate / 'key.pem'), '-out', str(certificate / 'cert.pem'),
                '-days', '1', '-subj', '/CN=localhost',
                '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], check=True, capture_output=True)
tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
tls.load_cert_chain(str(certificate / 'cert.pem'), str(certificate / 'key.pem'))
server.socket = tls.wrap_socket(server.socket, server_side=True)
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'https://localhost:{server.server_port}/'
results = {'browser': args.browser, 'scope': 'browser import/recovery only; not physical iPhone/background or synchronization accuracy',
           'inputBytes': source.stat().st_size, 'cases': []}
try:
    with sync_playwright() as p:
        browser_type = getattr(p, args.browser)
        launch = {'headless': True}
        if args.browser == 'chromium':
            chrome = shutil.which('google-chrome') or shutil.which('chromium') or shutil.which('chromium-browser')
            if chrome:
                launch['executable_path'] = chrome
        for fault in [False, True]:
            profile = tempfile.TemporaryDirectory(prefix='subsync-media-import-profile-')
            context = browser_type.launch_persistent_context(profile.name, **launch,
                viewport={'width': 393, 'height': 852}, is_mobile=True, has_touch=True, ignore_https_errors=True)
            page = context.new_page()
            if fault:
                page.add_init_script('(' + FAULT_SCRIPT + ')()')
            page.goto(url, wait_until='load')
            capabilities = page.evaluate('''() => ({secure:isSecureContext,
              storage:!!navigator.storage?.getDirectory, crypto:!!crypto.subtle})''')
            assert all(capabilities.values()), capabilities
            ref = page.locator('input[name="streams-group-ref-file"]')
            ref.wait_for(state='attached')
            ref.set_input_files(str(source))
            group = ref.locator('xpath=..')
            try:
                group.locator('input[type=radio]').first.wait_for(state='attached', timeout=120000)
            except Exception:
                print(page.locator('#subsync_app').inner_text())
                raise
            assert group.locator('select').first.input_value() == 'ita'
            assert page.locator('.popup:not(:has(.spinner))').count() == 0
            copied = page.evaluate('''async () => {
              const root = await navigator.storage.getDirectory();
              try {
                const dir = await root.getDirectoryHandle('subsync2-read-recovery');
                const files = [];
                for await (const [,entry] of dir.entries()) files.push((await entry.getFile()).size);
                return files;
              } catch (_) { return []; }
            }''')
            assert copied == ([source.stat().st_size] if fault else []), copied
            if fault:
                assert page.evaluate('window.__readFaultInjected === true')
            results['cases'].append({'faultInjected': fault, 'importedAudioLanguage': 'ita', 'verifiedCopyBytes': copied})

            # A malformed MP4 must still fail; the retry must not relax FFmpeg.
            bad = bytes.fromhex('000000186674797069736f6d0000020069736f6d69736f32')
            ref.set_input_files({'name': 'invalid-' + 'very-long-name-' * 12 + '.mp4', 'mimeType': 'video/mp4', 'buffer': bad})
            popup = page.locator('#subsync_app .popup').last
            popup.wait_for(state='visible', timeout=30000)
            page.wait_for_function("document.querySelector('#subsync_app .popup pre')?.textContent.includes('localReadRecovery')", timeout=30000)
            assert 'Demux.avformat_open_input' in popup.inner_text()
            assert 'AVERROR_INVALIDDATA' in popup.inner_text()
            assert group.locator('input[type=radio]').count() == 0
            copied_after = page.evaluate('''async () => {
              const root = await navigator.storage.getDirectory();
              const dir = await root.getDirectoryHandle('subsync2-read-recovery');
              const names = []; for await (const [name] of dir.entries()) names.push(name); return names;
            }''')
            assert copied_after == [], copied_after
            for width in [320, 393]:
                page.set_viewport_size({'width': width, 'height': 852})
                geometry = popup.evaluate('''el => {
                  const box = el.getBoundingClientRect(), close = el.querySelector('.popup_close').getBoundingClientRect();
                  return {left:box.left, right:box.right, scroll:el.scrollWidth, client:el.clientWidth,
                    closeLeft:close.left, closeRight:close.right, width:innerWidth};
                }''')
                assert geometry['left'] >= -1 and geometry['right'] <= width + 1, geometry
                assert geometry['scroll'] <= geometry['client'] + 1, geometry
                assert geometry['closeLeft'] >= 0 and geometry['closeRight'] <= width, geometry
            page.screenshot(path=str(OUT / f'{args.browser}-error-dialog.png'))
            popup.locator('.popup_close').click()
            results['cases'][-1]['invalidFileRejectedAndCopiesReleased'] = True
            results['cases'][-1]['dialogFits320And393'] = True
            context.close()
            profile.cleanup()
    results['status'] = 'pass'
finally:
    server.shutdown()
    certificate_dir.cleanup()
    (OUT / f'{args.browser}.json').write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps(results, indent=2))
