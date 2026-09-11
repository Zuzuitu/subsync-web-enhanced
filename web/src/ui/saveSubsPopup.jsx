import { el, mount, unmount } from 'redom';
import i18n from 'es2015-i18n-tag';
import { Overlay, OverlayItem } from './overlay.jsx';
import Synchronizer from '../synchro.js';
import Logger from '../logger.js';
const logger = Logger.logger.get('[SaveSubtitlesPopup]');

export default class SaveSubtitlesPopup extends OverlayItem {

  constructor(props) {
    super(i18n`Select format`, true);
    this.props = props;

    <div this='content'>
      <dl>
        <dt>SubRip:</dt>
        <dd><a this='srtButton' /></dd>
        <dt>Advanced Substation:</dt>
        <dd><a this='assButton' /></dd>
        <dt>TMP:</dt>
        <dd><a this='tmpButton' /></dd>
      </dl>
      {props.lang && this.renderAppendLangCheckbox()}
    </div>;

    this.update();
  }

  renderAppendLangCheckbox() {
    return(
      <label>
        <input type='checkbox' this='appendLang' onclick={this.update.bind(this)} />
        {i18n`append language code`}
      </label>
    );
  }

  update() {
    const { fileName, lang } = this.props;
    let baseName = fileName.replace(/\.[^/.]+$/, '');
    if (this.appendLang && this.appendLang.checked && lang) {
      baseName = `${baseName}.${lang}`;
    }

    this.configureFormat(this.srtButton, 'srt', `${baseName}.srt`);
    this.configureFormat(this.assButton, 'ass', `${baseName}.ass`);
    this.configureFormat(this.tmpButton, 'tmp', `${baseName}.txt`);
  }

  configureFormat(button, fmt, name) {
    button.textContent = name;
    button.onclick = () => {
      this.hide();
      this.save(fmt, name);
    };
  }

  save(fmt, name) {
    try {
      const subs = Synchronizer.instance.getSynchronizedSubtitles(fmt);
      if (!subs) {
        throw new Error(i18n`Subtitles not ready!`);
      }
      const file = new Blob(subs, {type: 'text/plain'});
      const url = URL.createObjectURL(file);
      const a = <a download={name} href={url} hidden />;
      mount(document.body, a);
      a.click();
      setTimeout(() => {
        unmount(document.body, a);
        window.URL.revokeObjectURL(url);
      }, 0);
    } catch (e) {
      logger.warn('save failed:', e);
      Overlay.showErrorPopup(i18n`Couldn't save subtitles`, e);
    }
  }
}
