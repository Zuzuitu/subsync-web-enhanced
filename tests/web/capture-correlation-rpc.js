// Test-only observer for synthetic fixtures. No application messages are changed.
(() => {
  const trace = window.__correlationTrace = { events: [], dropped: 0 };
  const original = Worker.prototype.postMessage;
  const watched = new WeakSet();
  const pending = new WeakMap();
  const methods = new Set(['addSubWord', 'addRefWord', 'addSubtitles', 'getStats']);
  const record = event => {
    if (trace.events.length < 20000) trace.events.push(event);
    else trace.dropped++;
  };
  Worker.prototype.postMessage = function(message, ...rest) {
    if (!watched.has(this)) {
      watched.add(this);
      pending.set(this, new Map());
      this.addEventListener('message', event => {
        const method = pending.get(this).get(event.data?.id);
        if (!method) return;
        pending.get(this).delete(event.data.id);
        if (method === 'getStats') {
          record({ direction: 'response', method, value: event.data.value });
        }
      });
    }
    const method = message?.path?.[0];
    if (message?.type === 'APPLY' && methods.has(method)) {
      const args = (message.argumentList || []).map(arg => arg.value);
      record({ direction: 'request', method, args });
      if (method === 'getStats') pending.get(this).set(message.id, method);
    }
    return original.call(this, message, ...rest);
  };
})();
