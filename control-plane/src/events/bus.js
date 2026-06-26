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

/**
 * Typed bus wrapper that validates event payloads against schemas.
 *
 * Schemas are functions: `schema(payload) => true` for valid, or throw/false.
 * After registering a schema, `typedBus.emit` validates the payload before
 * forwarding to the underlying EventEmitter. Invalid payloads log a warning
 * but are still emitted (non-breaking, never throws).
 *
 * Usage:
 *   const { typedBus } = require('./bus');
 *   typedBus.registerSchema('pod_state_change', (p) => typeof p.pod === 'string');
 *   typedBus.on('pod_state_change', handler);
 *   typedBus.emit('pod_state_change', { pod: 'web-0', mode: 'http_500' });
 */
const schemas = new Map();

const typedBus = {
  registerSchema(eventName, validator) {
    if (typeof validator !== 'function') {
      throw new TypeError('typedBus schema validator must be a function');
    }
    schemas.set(eventName, validator);
  },

  on(eventName, handler) {
    bus.on(eventName, handler);
  },

  emit(eventName, payload) {
    const validator = schemas.get(eventName);
    if (validator) {
      try {
        const result = validator(payload);
        if (!result) {
          console.warn(`typedBus: schema validation failed for "${eventName}"`, payload);
        }
      } catch (err) {
        console.warn(`typedBus: schema validation threw for "${eventName}":`, err.message);
      }
    }
    bus.emit(eventName, payload);
  },

  off(eventName, handler) {
    bus.off(eventName, handler);
  },
};

module.exports = { bus, typedBus };
