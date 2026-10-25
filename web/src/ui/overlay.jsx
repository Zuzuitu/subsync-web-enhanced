import { el, mount, unmount } from 'redom';
import i18n from 'es2015-i18n-tag';
import settings from '../settings.js';
import uiText from './romanian-ui.js';

export class OverlayItem {

  constructor(title, closable) {
    this.title = title;
    this.closable = closable;
  }

  delayedShow(timeout) {
    this.timer = setTimeout(this.show.bind(this), timeout);
    return this;
  }

  show() {
    const containerStyle = {
      display: 'flex',
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      minWidth: 0,
      padding: '16px',
      height: '100%',
      overflow: 'auto',
      zIndex: 1000,
      backgroundColor: 'rgba(0,0,0,0.5)',
    };

    <div this='el' style={containerStyle}>
      <div class='popup'>
        {this.title && this.renderHeader()}
        {this.content}
      </div>
    </div>;

    mount(Overlay.parent, this.el);
    return this;
  }

  renderHeader() {
    return (
      <div class='popup_header'>
        {this.title ? <h1>{this.title}</h1> : null}
        {this.closable ? <a class='popup_close' onclick={this.hide.bind(this)}>&times;</a> : null}
      </div>);
  }

  hide() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    if (this.el) {
      unmount(Overlay.parent, this.el);
      this.el = undefined;
    }
  }
}

export class Overlay {

  static init(parent) {
    this.parent = parent;
  }

  static showSpinner(msg) {
    const spinner = new OverlayItem();
    spinner.content = (
      <p class='spinner'>
        <span class='spinner_icon' aria-hidden='true' />
        <span>{msg || i18n`loading...`}</span>
      </p>);
    return spinner.delayedShow(100);
  }

  static showPopup(title, content) {
    const popup = new OverlayItem(title, true);
    popup.content = content;
    return popup.show();
  }

  static showErrorPopup(title, err) {
    const invalidContainer = err && err.module === 'Demux.avformat_open_input'
      && (err.averror === 'AVERROR_INVALIDDATA' || Number(err.code) === -1094995529);
    return Overlay.showPopup(title, [
      invalidContainer && <p>{uiText('The media reader could not open the selected file. Download the original completely in Files and select it again. The technical details below do not by themselves prove that the audio is corrupt.')}</p>,
      err && err.localReadRecovery && <p>{uiText(err.localReadRecovery.message)}</p>,
      <p>{getErrorMessage(err)}</p>,
      <pre>{getErrorDetails(err)}</pre>
    ]);
  }
}

function getErrorMessage(e) {
  const msg = e.message || i18n`Error`;
  return msg.charAt(0).toUpperCase() + msg.substring(1);
}

function getErrorDetails(e) {
  if (typeof e === 'object') {
    const fields = [];
    for (const key in e) {
      if (key !== 'message') {
        fields.push(`${key}: ${JSON.stringify(e[key])}`);
      }
    }
    return fields.length ? fields.join('\n') : null;
  } else if (e != null) {
    return JSON.stringify(e, null, 4);
  }
}
