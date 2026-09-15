const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
class Worker {
  constructor() { this.listeners = []; this.calls = []; }
  addEventListener(type, listener) { this.listeners.push(listener); }
  postMessage(...args) { this.calls.push(args); return 'native result'; }
}
const window = {};
vm.runInNewContext(fs.readFileSync('tests/web/capture-correlation-rpc.js', 'utf8'), {Worker, window});
const worker = new Worker();
const message = {type: 'APPLY', id: 'a', path: ['addRefWord'], argumentList: [{type: 'RAW', value: {text: 'cuvânt', time: 12.5}}]};
const transfer = [];
assert.equal(worker.postMessage(message, transfer), 'native result');
assert.strictEqual(worker.calls[0][0], message);
assert.strictEqual(worker.calls[0][1], transfer);
worker.postMessage({type: 'APPLY', id: 'b', path: ['getStats'], argumentList: []});
worker.listeners[0]({data: {id: 'b', value: {formula: {a: 1, b: -8}}}});
assert.equal(window.__correlationTrace.events.length, 3);
assert.equal(window.__correlationTrace.events[2].value.formula.b, -8);
worker.postMessage({type: 'APPLY', id: 'c', path: ['run'], argumentList: []});
assert.equal(window.__correlationTrace.events.length, 3);
assert.equal(worker.listeners.length, 1);
console.log('Synthetic RPC capture preserves original messages: OK');
