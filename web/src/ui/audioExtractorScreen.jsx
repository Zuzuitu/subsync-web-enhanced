import { el } from 'redom';

export default class AudioExtractorScreen {
  constructor() {
    <div this='el' class='audio_extractor_screen'>
      <div class='audio_extractor_intro'>
        <h1>Audio Extractor</h1>
        <p>Extract audio from MKV / MP4 locally on your device. No media upload.</p>
      </div>
      <iframe
        class='audio_extractor_frame'
        title='SubSync2 Audio Extractor'
        src='./audio-extractor/index.html'
        loading='eager'
      />
    </div>;
  }
}
