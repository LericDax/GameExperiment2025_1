/**
 * Minimal event emitter compatible with the subset of the Node.js EventEmitter API
 * used across the AI systems. The implementation avoids Node-specific imports so
 * it can be safely bundled for the browser.
 */
export class EventEmitter {
  constructor() {
    this._listeners = new Map();
    this._onceWrappers = new Map();
    this._onceReverse = new Map();
  }

  on(eventName, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('EventEmitter.on requires a listener function');
    }
    const bucket = this._listeners.get(eventName);
    if (bucket) {
      bucket.push(listener);
    } else {
      this._listeners.set(eventName, [listener]);
    }
    return this;
  }

  off(eventName, listener) {
    const bucket = this._listeners.get(eventName);
    if (!bucket) {
      return this;
    }

    let target = listener;
    if (this._onceWrappers.has(listener)) {
      target = this._onceWrappers.get(listener);
      this._onceWrappers.delete(listener);
      this._onceReverse.delete(target);
    } else if (this._onceReverse.has(listener)) {
      const original = this._onceReverse.get(listener);
      this._onceWrappers.delete(original);
      this._onceReverse.delete(listener);
    }

    const index = bucket.indexOf(target);
    if (index !== -1) {
      bucket.splice(index, 1);
    }
    if (bucket.length === 0) {
      this._listeners.delete(eventName);
    }
    return this;
  }

  once(eventName, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('EventEmitter.once requires a listener function');
    }
    const wrapped = (...args) => {
      this.off(eventName, wrapped);
      listener.apply(this, args);
    };
    this._onceWrappers.set(listener, wrapped);
    this._onceReverse.set(wrapped, listener);
    this.on(eventName, wrapped);
    return this;
  }

  emit(eventName, ...args) {
    const bucket = this._listeners.get(eventName);
    if (!bucket || bucket.length === 0) {
      return false;
    }
    const listeners = bucket.slice();
    for (const listener of listeners) {
      listener.apply(this, args);
    }
    return true;
  }
}

export const createEventEmitter = () => new EventEmitter();
