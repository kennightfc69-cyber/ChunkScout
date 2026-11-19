/* ChunkScout original pixel textures.
   Every texture here is drawn procedurally by this file (seeded noise + simple patterns) in a block-like style.
   No Mojang/Minecraft texture files are used or bundled. */
(function () {
  var cache = {};
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { return function () { seed = (seed + 0x6D2B79F5) | 0; var t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hex(h) { return [1, 3, 5].map(function (i) { return parseInt(h.substr(i, 2), 16); }); }
  function kind(name, group) {
    var n = name.toLowerCase();
    if (/glass/.test(n)) return 'glass';
    if (/ore$|ore\b/.test(n)) return 'ore';
    if (/brick|tiles|polished|smooth|chiseled|cut |quartz|purpur|prismarine bricks/.test(n)) return /brick|tiles/.test(n) ? 'bricks' : 'smooth';
    if (/cobble/.test(n)) return 'cobble';
    if (/plank/.test(n)) return 'planks';
    if (/log|wood|stem|hyphae|basalt/.test(n)) return 'log';
    if (/leaves|moss|grass|wart block|shroomlight/.test(n)) return 'leafy';
    if (/sand|gravel|dirt|soil|clay|mud|powder|snow/.test(n)) return 'grainy';
    if (/^block of|block$/.test(n) && group === 'mineral') return 'metal';
    if (group === 'concrete') return 'concrete';
    if (group === 'wool') return 'wool';
    if (group === 'terracotta') return 'terracotta';
    if (group === 'wood') return 'planks';
    return 'stone';
  }
  function make(name, color, group) {
    var key = name + '|' + color; if (cache[key]) return cache[key];
    var c = document.createElement('canvas'); c.width = c.height = 16; var g = c.getContext('2d'), im = g.createImageData(16, 16), d = im.data;
    var base = hex(color), r = rng(hash(name)), k = kind(name, group), x, y, i;
    function put(x, y, f, a) { var o = (y * 16 + x) * 4; d[o] = Math.max(0, Math.min(255, base[0] * f)); d[o + 1] = Math.max(0, Math.min(255, base[1] * f)); d[o + 2] = Math.max(0, Math.min(255, base[2] * f)); d[o + 3] = a == null ? 255 : a; }
    function noise(amp) { for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) put(x, y, 1 + (r() - 0.5) * amp); }
    // value noise (blobs) for stone-like surfaces
    var grid = []; for (i = 0; i < 25; i++) grid.push(r());
    function blob(x, y) { var gx = x / 4, gy = y / 4, x0 = Math.floor(gx), y0 = Math.floor(gy), tx = gx - x0, ty = gy - y0, G = function (a, b) { return grid[(b % 5) * 5 + (a % 5)]; };
      return (G(x0, y0) * (1 - tx) + G(x0 + 1, y0) * tx) * (1 - ty) + (G(x0, y0 + 1) * (1 - tx) + G(x0 + 1, y0 + 1) * tx) * ty; }
    switch (k) {
      case 'concrete': noise(0.05); break;
      case 'wool': for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) put(x, y, 1 + ((x + y * 2) % 4 === 0 ? -0.09 : 0) + (r() - 0.5) * 0.1); break;
      case 'terracotta': for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) put(x, y, 0.94 + blob(x, y) * 0.1 + (r() - 0.5) * 0.06); break;
      case 'grainy': for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) put(x, y, 1 + (r() - 0.5) * 0.28); break;
      case 'smooth': noise(0.04); for (i = 0; i < 16; i++) { put(i, 0, 1.12); put(0, i, 1.12); put(i, 15, 0.82); put(15, i, 0.82); } break;
      case 'metal': noise(0.05); for (i = 1; i < 15; i++) { put(i, 1, 1.18); put(1, i, 1.18); put(i, 14, 0.78); put(14, i, 0.78); } for (i = 0; i < 16; i++) { put(i, 0, 0.7); put(0, i, 0.7); put(i, 15, 0.7); put(15, i, 0.7); } break;
      case 'bricks':
        for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) { var row = y >> 2, off = row % 2 ? 4 : 0, mortar = y % 4 === 3 || (x + off) % 8 === 7; put(x, y, mortar ? 0.68 : 1 + (r() - 0.5) * 0.12 + (y % 4 === 0 ? 0.06 : 0)); } break;
      case 'cobble':
        var cells = []; for (i = 0; i < 9; i++) cells.push([r() * 16, r() * 16, 0.85 + r() * 0.3]);
        for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) { var b1 = 1e9, b2 = 1e9, cc = 0; cells.forEach(function (p, j) { for (var ox = -16; ox <= 16; ox += 16) for (var oy = -16; oy <= 16; oy += 16) { var dd = (x - p[0] - ox) * (x - p[0] - ox) + (y - p[1] - oy) * (y - p[1] - oy); if (dd < b1) { b2 = b1; b1 = dd; cc = j; } else if (dd < b2) b2 = dd; } });
          put(x, y, Math.sqrt(b2) - Math.sqrt(b1) < 1.1 ? 0.6 : cells[cc][2] + (r() - 0.5) * 0.08); } break;
      case 'planks':
        for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) { var pr = y >> 2, seam = y % 4 === 3 || (x === (pr * 5 + 3) % 16 && y % 4 !== 3); put(x, y, seam ? 0.7 : 1 + Math.sin((x + pr * 7) * 0.9) * 0.04 + (r() - 0.5) * 0.08); } break;
      case 'log':
        for (x = 0; x < 16; x++) { var col = 1 + (r() - 0.5) * 0.25; for (y = 0; y < 16; y++) put(x, y, (x % 3 === 0 ? 0.78 : col) + (r() - 0.5) * 0.06); } break;
      case 'leafy': for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) put(x, y, r() < 0.18 ? 0.7 : 1 + (r() - 0.5) * 0.3); break;
      case 'ore':
        for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) put(x, y, 0.95 + blob(x, y) * 0.12 + (r() - 0.5) * 0.06);
        for (i = 0; i < 5; i++) { var sx = 2 + (r() * 11 | 0), sy = 2 + (r() * 11 | 0); [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(function (q) { if (r() < 0.85) put(sx + q[0], sy + q[1], 1.55); }); } break;
      case 'glass':
        for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) { var edge = x === 0 || y === 0 || x === 15 || y === 15; put(x, y, edge ? 1.15 : 1, edge ? 255 : ((x === y + 3 || x === y + 4) && x > 3 && x < 11 ? 170 : 70)); } break;
      default: for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) put(x, y, 0.93 + blob(x, y) * 0.14 + (r() - 0.5) * 0.07);
    }
    g.putImageData(im, 0, 0);
    var url = c.toDataURL(); cache[key] = { canvas: c, url: url, kind: k }; return cache[key];
  }
  window.CSPix = { make: make, kind: kind };
})();
