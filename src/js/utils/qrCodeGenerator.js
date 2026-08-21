/**
 * Lightweight pure JavaScript QR Code Generator for HTML5 Canvas.
 * Supports Byte encoding mode with Error Correction Level M/L.
 */

// QR Code Constants & Galois Field Tables
const EXP_TABLE = new Array(256);
const LOG_TABLE = new Array(256);

(function initGF() {
  let x = 1;
  for (let i = 0; i < 256; i++) {
    EXP_TABLE[i] = x;
    LOG_TABLE[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
})();

function glog(n) {
  if (n < 1) throw new Error('glog error');
  return LOG_TABLE[n];
}

function gexp(n) {
  while (n < 0) n += 255;
  while (n >= 255) n -= 255;
  return EXP_TABLE[n];
}

// Polynomial generator for Reed-Solomon Error Correction
function Polynomial(num, shift) {
  if (num.length === undefined) throw new Error('Invalid num length');
  let offset = 0;
  while (offset < num.length && num[offset] === 0) offset++;
  this.num = new Array(num.length - offset + shift);
  for (let i = 0; i < num.length - offset; i++) this.num[i] = num[offset + i];
}

Polynomial.prototype = {
  get(index) {
    return this.num[index];
  },
  getLength() {
    return this.num.length;
  },
  multiply(e) {
    const num = new Array(this.getLength() + e.getLength() - 1).fill(0);
    for (let i = 0; i < this.getLength(); i++) {
      for (let j = 0; j < e.getLength(); j++) {
        num[i + j] ^= gexp(glog(this.get(i)) + glog(e.get(j)));
      }
    }
    return new Polynomial(num, 0);
  },
  mod(e) {
    if (this.getLength() - e.getLength() < 0) return this;
    const ratio = glog(this.get(0)) - glog(e.get(0));
    const num = new Array(this.getLength());
    for (let i = 0; i < this.getLength(); i++) num[i] = this.get(i);
    for (let i = 0; i < e.getLength(); i++) {
      num[i] ^= gexp(glog(e.get(i)) + ratio);
    }
    return new Polynomial(num, 0).mod(e);
  },
};

function getRSGeneratorPolynomial(errorCorrectionLength) {
  let a = new Polynomial([1], 0);
  for (let i = 0; i < errorCorrectionLength; i++) {
    a = a.multiply(new Polynomial([1, gexp(i)], 0));
  }
  return a;
}

// QR Code Data Specs (Versions 1-10 Byte Mode, Level L/M)
const QR_SPECS = [
  null,
  { version: 1, totalDataBytes: 19, ecBytes: 7, size: 21 },
  { version: 2, totalDataBytes: 34, ecBytes: 10, size: 25 },
  { version: 3, totalDataBytes: 55, ecBytes: 15, size: 29 },
  { version: 4, totalDataBytes: 80, ecBytes: 20, size: 33 },
  { version: 5, totalDataBytes: 108, ecBytes: 26, size: 37 },
  { version: 6, totalDataBytes: 136, ecBytes: 18, size: 41 },
  { version: 7, totalDataBytes: 156, ecBytes: 20, size: 45 },
  { version: 8, totalDataBytes: 194, ecBytes: 24, size: 49 },
  { version: 9, totalDataBytes: 232, ecBytes: 30, size: 53 },
  { version: 10, totalDataBytes: 274, ecBytes: 18, size: 57 },
];

function selectVersion(byteLength) {
  for (let v = 1; v < QR_SPECS.length; v++) {
    if (QR_SPECS[v].totalDataBytes >= byteLength + 3) {
      return QR_SPECS[v];
    }
  }
  return QR_SPECS[QR_SPECS.length - 1];
}

// Simple bit buffer
function BitBuffer() {
  this.buffer = [];
  this.length = 0;
}

BitBuffer.prototype = {
  put(num, length) {
    for (let i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  },
  putBit(bit) {
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) this.buffer.push(0);
    if (bit) this.buffer[bufIndex] |= 0x80 >>> this.length % 8;
    this.length++;
  },
};

function getUtf8Bytes(str) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str);
  }
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return new Uint8Array(bytes);
}

/**
 * Creates QR Code matrix 2D array of booleans.
 * @param {string} text
 * @returns {{modules: boolean[][], size: number}}
 */
export function createQrMatrix(text) {
  const bytes = getUtf8Bytes(text);
  const spec = selectVersion(bytes.length);
  const size = spec.size;

  // Bitstream creation
  const bb = new BitBuffer();
  bb.put(4, 4); // Byte Mode Indicator
  bb.put(bytes.length, spec.version < 10 ? 8 : 16); // Character count
  for (let i = 0; i < bytes.length; i++) bb.put(bytes[i], 8);

  // Terminate & Padding
  const maxDataBits = spec.totalDataBytes * 8;
  if (bb.length + 4 <= maxDataBits) bb.put(0, 4);
  while (bb.length % 8 !== 0) bb.putBit(false);

  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bb.length < maxDataBits) {
    bb.put(padBytes[padIdx % 2], 8);
    padIdx++;
  }

  // Error Correction Calculation
  const dataPolynomial = new Polynomial(bb.buffer, spec.ecBytes);
  const rsPoly = getRSGeneratorPolynomial(spec.ecBytes);
  const modPoly = dataPolynomial.mod(rsPoly);

  const ecData = new Array(spec.ecBytes).fill(0);
  for (let i = 0; i < modPoly.getLength(); i++) {
    ecData[i + spec.ecBytes - modPoly.getLength()] = modPoly.get(i);
  }

  const finalCodewords = bb.buffer.concat(ecData);

  // Matrix Creation
  const modules = Array.from({ length: size }, () =>
    new Array(size).fill(null)
  );

  // Finder Patterns
  function drawFinderPattern(row, col) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        if (row + r < 0 || row + r >= size || col + c < 0 || col + c >= size)
          continue;
        const isDark =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        modules[row + r][col + c] = isDark;
      }
    }
  }

  drawFinderPattern(0, 0);
  drawFinderPattern(size - 7, 0);
  drawFinderPattern(0, size - 7);

  // Timing Patterns
  for (let i = 8; i < size - 8; i++) {
    if (modules[6][i] === null) modules[6][i] = i % 2 === 0;
    if (modules[i][6] === null) modules[i][6] = i % 2 === 0;
  }

  // Dark Module
  modules[size - 8][8] = true;

  // Place Data
  let bitIdx = 0;
  const totalBits = finalCodewords.length * 8;
  let dir = -1;
  let r = size - 1;

  for (let c = size - 1; c > 0; c -= 2) {
    if (c === 6) c--;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      for (let colOffset = 0; colOffset < 2; colOffset++) {
        const curC = c - colOffset;
        if (modules[r][curC] === null) {
          let dark = false;
          if (bitIdx < totalBits) {
            const bytePos = Math.floor(bitIdx / 8);
            const bitPos = 7 - (bitIdx % 8);
            dark = ((finalCodewords[bytePos] >>> bitPos) & 1) === 1;
            bitIdx++;
          }
          // Mask pattern 0 (row + col) % 2 === 0
          if ((r + curC) % 2 === 0) dark = !dark;
          modules[r][curC] = dark;
        }
      }
      r += dir;
      if (r < 0 || r >= size) {
        r -= dir;
        dir = -dir;
        break;
      }
    }
  }

  return { modules, size };
}

/**
 * Renders a QR code onto an HTML5 canvas element.
 * @param {HTMLCanvasElement} canvas
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.margin=4]
 * @param {string} [options.dark='#000000']
 * @param {string} [options.light='#ffffff']
 */
export function renderQrCodeToCanvas(canvas, text, options = {}) {
  if (!canvas || !text) return;
  const { margin = 4, dark = '#000000', light = '#ffffff' } = options;

  const { modules, size } = createQrMatrix(text);
  const totalSize = size + margin * 2;

  const width = canvas.width || 240;
  const height = canvas.height || 240;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, width, height);

  const cellSize = width / totalSize;

  ctx.fillStyle = dark;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) {
        const x = Math.round((c + margin) * cellSize);
        const y = Math.round((r + margin) * cellSize);
        const w = Math.ceil(cellSize);
        const h = Math.ceil(cellSize);
        ctx.fillRect(x, y, w, h);
      }
    }
  }
}
