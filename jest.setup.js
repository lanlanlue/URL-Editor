const crypto = require('crypto');

// JSDOM (the test environment used by Jest) does not implement crypto.randomUUID.
// This polyfill exposes the Node.js crypto.randomUUID method on the `self`
// object, which is what the application code expects.
Object.defineProperty(self, 'crypto', {
  value: {
    subtle: crypto.webcrypto.subtle,
    getRandomValues: crypto.webcrypto.getRandomValues.bind(crypto.webcrypto),
    randomUUID: () => crypto.randomUUID(),
  },
});

// JSDOM does not implement IntersectionObserver. Provide a no-op stub so that
// modules using it for lazy-loading can be imported without errors in tests.
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom does not expose the Fetch API constructors in this project version.
// Keep a tiny test-only implementation for the Pages Function boundary tests.
if (typeof global.Headers === 'undefined') {
  global.Headers = class Headers {
    constructor(init = {}) {
      this.values = new Map(
        Object.entries(init).map(([key, value]) => [
          key.toLowerCase(),
          String(value),
        ])
      );
    }
    get(key) {
      return this.values.get(key.toLowerCase()) || null;
    }
    set(key, value) {
      this.values.set(key.toLowerCase(), String(value));
    }
    append(key, value) {
      const normalized = key.toLowerCase();
      this.values.set(
        normalized,
        this.values.has(normalized)
          ? `${this.values.get(normalized)}, ${value}`
          : String(value)
      );
    }
  };
}

if (typeof global.Response === 'undefined') {
  global.Response = class Response {
    constructor(body = '', options = {}) {
      this.body = body;
      this.status = options.status || 200;
      this.headers = new global.Headers(options.headers);
    }
    async json() {
      return JSON.parse(this.body);
    }
  };
}

if (typeof global.Request === 'undefined') {
  global.Request = class Request {
    constructor(url, options = {}) {
      this.url = url;
      this.method = options.method || 'GET';
      this.headers = new global.Headers(options.headers);
      this.body = options.body || '';
    }
    async arrayBuffer() {
      return Buffer.from(this.body).buffer.slice(0);
    }
  };
}
