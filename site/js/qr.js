/* A small QR code maker, for the profile link in Settings (site/js/me.js): scan it with a phone's camera and the
   profile opens there and stays signed in. No library: it follows the QR Code standard (ISO/IEC 18004) the way
   Project Nayuki's reference does, for byte mode with error correction level M (about 15% of the code can be
   scuffed and it still reads), versions 1 to 10 (up to 213 bytes; a profile link is about 50).
   window.AmbleQR: { svg(text, { label }) -> SVGElement, matrix(text) -> rows of true (dark) / false } */
(function () {
  "use strict";

  var ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];   // level M, versions 1-10
  var BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

  function rawModules(ver) {          // data + error-correction modules in a version
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  function dataCodewords(ver) { return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * BLOCKS[ver]; }

  // ---- Reed-Solomon over GF(2^8), polynomial 0x11D ----
  function mul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
    return z;
  }
  function divisor(degree) {
    var r = [];
    for (var i = 0; i < degree - 1; i++) r.push(0);
    r.push(1);
    var root = 1;
    for (i = 0; i < degree; i++) {
      for (var j = 0; j < r.length; j++) { r[j] = mul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
      root = mul(root, 0x02);
    }
    return r;
  }
  function remainder(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift();
      r.push(0);
      div.forEach(function (c, i) { r[i] ^= mul(c, f); });
    });
    return r;
  }

  function utf8(text) { return Array.prototype.slice.call(new TextEncoder().encode(text)); }

  function encode(text) {
    var bytes = utf8(text), ver = 1;
    for (; ver <= 10; ver++) {
      var need = 4 + (ver < 10 ? 8 : 16) + bytes.length * 8;
      if (need <= dataCodewords(ver) * 8) break;
    }
    if (ver > 10) throw new Error("Too long for a QR code here.");
    var bits = [];
    function put(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    put(4, 4);                                           // byte mode
    put(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    var cap = dataCodewords(ver) * 8;
    put(0, Math.min(4, cap - bits.length));              // terminator
    put(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) {
      var v = 0;
      for (var j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      data.push(v);
    }
    // split into blocks, add error correction, interleave
    var nb = BLOCKS[ver], eccLen = ECC_PER_BLOCK[ver], raw = Math.floor(rawModules(ver) / 8);
    var nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), div = divisor(eccLen), blocks = [], k = 0;
    for (i = 0; i < nb; i++) {
      var dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
      k += dat.length;
      var ecc = remainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var out = [];
    for (i = 0; i < blocks[0].length; i++) {
      for (j = 0; j < blocks.length; j++) {
        if (i !== shortLen - eccLen || j >= nShort) out.push(blocks[j][i]);
      }
    }
    return { ver: ver, codewords: out };
  }

  function matrix(text) {
    var e = encode(text), ver = e.ver, size = ver * 4 + 17;
    var m = [], fn = [];
    for (var y = 0; y < size; y++) { m.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    function set(x, y, dark) { m[y][x] = dark; fn[y][x] = true; }

    // finder, timing, alignment, format and version areas
    for (var i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), xx = c[0] + dx, yy = c[1] + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, d !== 2 && d !== 4);
      }
    });
    var pos = [];
    if (ver > 1) {
      var n = Math.floor(ver / 7) + 2, step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
      pos = [6];
      for (var p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
    }
    pos.forEach(function (ay, a) {
      pos.forEach(function (ax, b) {
        if ((a === 0 && b === 0) || (a === 0 && b === pos.length - 1) || (a === pos.length - 1 && b === 0)) return;
        for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      });
    });
    function formatBits(mask) {
      var data = (0 << 3) | mask, r = data;                  // level M = 00
      for (var i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      var bits = ((data << 10) | r) ^ 0x5412;
      function b(i) { return ((bits >>> i) & 1) !== 0; }
      for (i = 0; i <= 5; i++) set(8, i, b(i));
      set(8, 7, b(6)); set(8, 8, b(7)); set(7, 8, b(8));
      for (i = 9; i < 15; i++) set(14 - i, 8, b(i));
      for (i = 0; i < 8; i++) set(size - 1 - i, 8, b(i));
      for (i = 8; i < 15; i++) set(8, size - 15 + i, b(i));
      set(8, size - 8, true);                                // the dark module
    }
    formatBits(0);
    if (ver >= 7) {
      var r = ver;
      for (i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      var vbits = (ver << 12) | r;
      for (i = 0; i < 18; i++) {
        var bit = ((vbits >>> i) & 1) !== 0, a1 = size - 11 + i % 3, b1 = Math.floor(i / 3);
        set(a1, b1, bit); set(b1, a1, bit);
      }
    }

    // the data, zigzagging up and down in pairs of columns from the right
    var cw = e.codewords, bi = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j, up = ((right + 1) & 2) === 0, yy = up ? size - 1 - vert : vert;
          if (!fn[yy][x] && bi < cw.length * 8) { m[yy][x] = ((cw[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0; bi++; }
        }
      }
    }

    // the mask that leaves the fewest confusing patterns
    function maskHit(k, x, y) {
      switch (k) {
        case 0: return (x + y) % 2 === 0;
        case 1: return y % 2 === 0;
        case 2: return x % 3 === 0;
        case 3: return (x + y) % 3 === 0;
        case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
        case 5: return (x * y) % 2 + (x * y) % 3 === 0;
        case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
        default: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
      }
    }
    function applyMask(k) {
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) if (!fn[y][x] && maskHit(k, x, y)) m[y][x] = !m[y][x];
    }
    function penalty() {
      var score = 0, dark = 0, x, y;
      function lines(get) {
        for (var a = 0; a < size; a++) {
          var run = 1, line = [get(a, 0)];
          for (var b = 1; b < size; b++) {
            var v = get(a, b);
            line.push(v);
            if (v === line[b - 1]) { run++; if (run === 5) score += 3; else if (run > 5) score++; } else run = 1;
          }
          var s = line.map(function (v) { return v ? "1" : "0"; }).join("");
          var re = /(?=(10111010000|00001011101))/g, mm;
          while ((mm = re.exec(s))) { score += 40; re.lastIndex++; }
        }
      }
      lines(function (a, b) { return m[a][b]; });
      lines(function (a, b) { return m[b][a]; });
      for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) {
        var c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
      }
      for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (m[y][x]) dark++;
      var total = size * size;
      score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
      return score;
    }
    var best = 0, bestScore = Infinity;
    for (var k = 0; k < 8; k++) {
      applyMask(k); formatBits(k);
      var sc = penalty();
      if (sc < bestScore) { bestScore = sc; best = k; }
      applyMask(k);                                          // undo (masking twice cancels out)
    }
    applyMask(best); formatBits(best);
    return m;
  }

  function svg(text, opts) {
    opts = opts || {};
    var m = matrix(text), size = m.length, quiet = 4, full = size + quiet * 2, d = "";
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) if (m[y][x]) d += "M" + (x + quiet) + " " + (y + quiet) + "h1v1h-1z";
    var NS = "http://www.w3.org/2000/svg";
    var s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 " + full + " " + full);
    s.setAttribute("class", "qr");
    s.setAttribute("role", "img");
    s.setAttribute("aria-label", opts.label || "QR code");
    s.setAttribute("shape-rendering", "crispEdges");
    var bg = document.createElementNS(NS, "rect");
    bg.setAttribute("width", full); bg.setAttribute("height", full); bg.setAttribute("fill", "#FFFFFF");
    var path = document.createElementNS(NS, "path");
    path.setAttribute("d", d); path.setAttribute("fill", "#2B1D14");
    s.append(bg, path);
    return s;
  }

  window.AmbleQR = { svg: svg, matrix: matrix };
})();
