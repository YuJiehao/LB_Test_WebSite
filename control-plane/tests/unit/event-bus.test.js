'use strict';

const { bus } = require('../../src/events/bus');

describe('Internal Event Bus (bus.js)', () => {
  test('on() handler is called when emit() runs with matching event name', () => {
    const handler = jest.fn();
    bus.on('pod_state_change', handler);

    bus.emit('pod_state_change', { pod: 'web-0', mode: 'http_500' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ pod: 'web-0', mode: 'http_500' });
  });

  test('multiple handlers receive the same event', () => {
    const handler1 = jest.fn();
    const handler2 = jest.fn();
    bus.on('drift_detected', handler1);
    bus.on('drift_detected', handler2);

    bus.emit('drift_detected', { pod: 'web-0', drift: true });

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler1).toHaveBeenCalledWith({ pod: 'web-0', drift: true });
    expect(handler2).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledWith({ pod: 'web-0', drift: true });
  });

  test('off() removes a handler so it is no longer called', () => {
    const handler = jest.fn();
    bus.on('pod_state_change', handler);
    bus.off('pod_state_change', handler);

    bus.emit('pod_state_change', { pod: 'web-0', mode: 'reset' });

    expect(handler).not.toHaveBeenCalled();
  });
});
