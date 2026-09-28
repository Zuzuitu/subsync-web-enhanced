import { el } from 'redom';

export default class AudioExtractorScreen {
  constructor() {
    <div this='el' class='audio_extractor_screen'>
      <iframe
        this='frame'
        class='audio_extractor_frame'
        title='SubSync2 Audio Extractor'
        src='./audio-extractor/index.html'
        loading='eager'
      />
    </div>;

    this.onMessage = event => {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== 'subsync2-audio-extractor-height') return;
      const height = Number(event.data.height);
      if (Number.isFinite(height) && height > 300) {
        this.frame.style.height = Math.min(height + 8, 2400) + 'px';
      }
    };
    window.addEventListener('message', this.onMessage);

    this.isAndroidShell = /\bSubSync2Android\//.test(navigator.userAgent);
    if (this.isAndroidShell) {
      this.frame.tabIndex = 0;
      this.frame.addEventListener('load', () => {
        this.frame.focus();
        try {
          this.frame.contentWindow.focus();
        } catch (_) {
          // Same-origin by construction; keep the iframe itself focused as fallback.
        }
      });
    }
  }
}
