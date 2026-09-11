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

    this.srtButton = el('a');
    this.assButton = el('a');
    this.tmpButton = el('a');

    const formatList = el(
      'dl',
      el('dt', 'SubRip:'),
      el('dd', this.srtButton),
      el('dt', 'Advanced Substation:'),
      el('dd', this.assButton),
      el('dt', 'TMP:'),
      el('dd', this.tmpButton),
    );

    const children = [formatList];
    if (props.lang) {
      this.appendLang = el('input', {type: 'checkbox'});
      this.appendLang.onclick = this.update.bind(this);
      children.push(el('label', this.appendLang, i18n`append language code`));
    }

    this.content = el('div', children);
    this.update();
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
    let url;
    let a;
    try {
      const subs = Synchronizer.instance.getSynchronizedSubtitles(fmt);
      if (!subs) {
        throw new Error(i18n`Subtitles not ready!`);
      }
      const file = new Blob(subs, {type: 'text/plain'});
      url = URL.createObjectURL(file);
      a = el('a', {download: name, href: url, hidden: true});
      mount(document.body, a);
      a.click();
    } catch (e) {
      logger.warn('save failed:', e);
      Overlay.showErrorPopup(i18n`Couldn't save subtitles`, e);
    } finally {
      if (a && url) {
        setTimeout(() => {
          unmount(document.body, a);
          window.URL.revokeObjectURL(url);
        }, 0);
      }
    }
  }
}
