const crypto = require('crypto');

// JSDOM (the test environment used by Jest) does not implement crypto.randomUUID.
// This polyfill exposes the Node.js crypto.randomUUID method on the `self`
// object, which is what the application code expects.
Object.defineProperty(self, 'crypto', {
  value: {
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
