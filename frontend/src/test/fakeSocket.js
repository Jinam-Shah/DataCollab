// Minimal stand-in for a socket.io client: on/off/emit to local listeners.
export function createFakeSocket() {
  const listeners = {};
  return {
    on(event, fn) {
      (listeners[event] ||= []).push(fn);
    },
    off(event, fn) {
      listeners[event] = (listeners[event] || []).filter((f) => f !== fn);
    },
    emit(event, payload) {
      (listeners[event] || []).forEach((fn) => fn(payload));
    },
    listenerCount(event) {
      return (listeners[event] || []).length;
    },
  };
}
