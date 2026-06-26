'use strict';

const EventEmitter = require('events');

const emitter = new EventEmitter();
emitter.setMaxListeners(100); // support dashboard + audit + poll subscribers

const bus = {
  on(eventName, handler) {
    emitter.on(eventName, handler);
  },
  emit(eventName, payload) {
    emitter.emit(eventName, payload);
  },
  off(eventName, handler) {
    emitter.off(eventName, handler);
  },
};

module.exports = { bus };
