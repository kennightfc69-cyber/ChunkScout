/* ChunkScout voxel engine: shape generation (in a Web Worker), 3D preview, layer blueprints and exports.
   Used by the sphere and shape generators. No external libraries. */
(function () {
  'use strict';

  /* ---------------- shape generation (runs inside a Web Worker) ---------------- */
  function workerMain() {
    self.onmessage = function (e) {
      var s = e.data.spec, reqId = e.data.id, X = s.x, Y = s.y, Z = s.z, N = X * Y * Z, t0 = Date.now();
      var inside = new Uint8Array(N), i = 0, x, y, z;
      var hx = X / 2, hy = Y / 2, hz = Z / 2, at = Math.max(1, s.thickness || 1);
      function sq(v) { return v * v; }
      for (y = 0; y < Y; y++) for (z = 0; z < Z; z++) for (x = 0; x < X; x++, i++) {
        var dx = (x + 0.5 - hx) / hx, dz = (z + 0.5 - hz) / hz, yn = (y + 0.5) / Y, v = false, r2 = dx * dx + dz * dz;
        switch (s.shape) {
          case 'sphere': case 'ellipsoid': v = r2 + sq((y + 0.5 - hy) / hy) <= 1; break;
          case 'dome': v = r2 + yn * yn <= 1; break;
          case 'cylinder': case 'ellipse': v = r2 <= 1; break;
          case 'cone': v = r2 <= sq(1 - yn); break;
          case 'pyramid': var k = 1 - y / Y; v = Math.abs(x + 0.5 - hx) <= hx * k && Math.abs(z + 0.5 - hz) <= hz * k; break;
          case 'arch':
            var ox = (x + 0.5 - hx) / hx, oy = (y + 0.5) / Y, ix = (x + 0.5 - hx) / Math.max(0.01, hx - at), iy = (y + 0.5) / Math.max(0.01, Y - at);
            v = ox * ox + oy * oy <= 1 && !(hx - at > 0 && Y - at > 0 && ix * ix + iy * iy <= 1); break;
        }
        inside[i] = v ? 1 : 0;
      }
      var out = inside;
      if (s.hollow && s.shape !== 'arch') {
        // distance (in face steps) from the outside; keep cells within `thickness`
        var dist = new Uint16Array(N), q = new Int32Array(N), qh = 0, qt = 0, INF = 65535;
        var openBottom = !!s.openBottom, openTop = !!s.openTop, flat = s.shape === 'ellipse';
        for (i = 0; i < N; i++) dist[i] = inside[i] ? INF : 0;
        // seed: inside cells that touch the outside (or the grid edge, except open ends)
        function idx(x, y, z) { return (y * Z + z) * X + x; }
        for (y = 0; y < Y; y++) for (z = 0; z < Z; z++) for (x = 0; x < X; x++) {
          i = idx(x, y, z); if (!inside[i]) continue;
          var edge = x === 0 || x === X - 1 || z === 0 || z === Z - 1 || (!flat && ((y === 0 && !openBottom) || (y === Y - 1 && !openTop)));
          var n = edge || (x > 0 && !inside[i - 1]) || (x < X - 1 && !inside[i + 1]) || (z > 0 && !inside[i - X]) || (z < Z - 1 && !inside[i + X]) ||
            (!flat && ((y > 0 && !inside[i - X * Z]) || (y < Y - 1 && !inside[i + X * Z])));
          if (!n && flat) { // 2D outlines: also count diagonal neighbours so the ring joins along full edges
            for (var a = -1; a <= 1 && !n; a++) for (var b = -1; b <= 1 && !n; b++) { var X2 = x + a, Z2 = z + b; if (X2 < 0 || Z2 < 0 || X2 >= X || Z2 >= Z || !inside[idx(X2, y, Z2)]) n = true; }
          }
          if (n) { dist[i] = 1; q[qt++] = i; }
        }
        while (qh < qt) {
          var c = q[qh++], d = dist[c]; if (d >= at) continue;
          var cx = c % X, cz = ((c / X) | 0) % Z, cy = (c / (X * Z)) | 0, nb = [];
          if (cx > 0) nb.push(c - 1); if (cx < X - 1) nb.push(c + 1); if (cz > 0) nb.push(c - X); if (cz < Z - 1) nb.push(c + X);
          if (!flat) { if (cy > 0) nb.push(c - X * Z); if (cy < Y - 1) nb.push(c + X * Z); }
          for (var j = 0; j < nb.length; j++) { var m = nb[j]; if (dist[m] === INF) { dist[m] = d + 1; q[qt++] = m; } }
        }
        out = new Uint8Array(N);
        for (i = 0; i < N; i++) out[i] = inside[i] && dist[i] <= at ? 1 : 0;
      }
      var layers = new Uint32Array(Y), count = 0;
      for (y = 0; y < Y; y++) { var lc = 0, base = y * X * Z; for (i = 0; i < X * Z; i++) lc += out[base + i]; layers[y] = lc; count += lc; }
      self.postMessage({ id: reqId, X: X, Y: Y, Z: Z, data: out, layers: layers, count: count, ms: Date.now() - t0 }, [out.buffer, layers.buffer]);
    };
  }
  var worker = null, nextId = 1, waiting = {};
  function generate(spec) {
    return new Promise(function (resolve, reject) {
      try {
        if (!worker) {
          worker = new Worker(URL.createObjectURL(new Blob(['(' + workerMain.toString() + ')()'], { type: 'text/javascript' })));
          worker.onmessage = function (e) { var w = waiting[e.data.id]; delete waiting[e.data.id]; if (w) w.resolve(e.data); };
          worker.onerror = function (e) { var ids = Object.keys(waiting); ids.forEach(function (k) { waiting[k].reject(e); delete waiting[k]; }); worker = null; };
        }
      } catch (e) { reject(e); return; }
      var id = nextId++; waiting[id] = { resolve: resolve, reject: reject };
      worker.postMessage({ id: id, spec: spec });
    });
  }

  /* ---------------- 3D preview ---------------- */
  function Viewer(canvas, opts) {
    opts = opts || {};
    var g = canvas.getContext('2d'), self = this, yaw = -0.7, pitch = 0.55, zoom = 1, vox = null, pts = null, n = 0, simplified = 1, hl = -1, raf = 0;
    var base = opts.color || [123, 220, 106], hlc = [242, 193, 78];
    this.set = function (v) {
      vox = v; var X = v.X, Y = v.Y, Z = v.Z, d = v.data, list = [], i = 0, x, y, z;
      for (y = 0; y < Y; y++) for (z = 0; z < Z; z++) for (x = 0; x < X; x++, i++) {
        if (!d[i]) continue;
        var nx = (x === 0 || !d[i - 1] ? -1 : 0) + (x === X - 1 || !d[i + 1] ? 1 : 0), nz = (z === 0 || !d[i - X] ? -1 : 0) + (z === Z - 1 || !d[i + X] ? 1 : 0),
          ny = (y === 0 || !d[i - X * Z] ? -1 : 0) + (y === Y - 1 || !d[i + X * Z] ? 1 : 0);
        var exposed = x === 0 || x === X - 1 || y === 0 || y === Y - 1 || z === 0 || z === Z - 1 || !d[i - 1] || !d[i + 1] || !d[i - X] || !d[i + X] || !d[i - X * Z] || !d[i + X * Z];
        if (!exposed) continue;
        // thin shells are open on both sides, so opposite directions cancel: fall back to the direction from the centre
        if (!nx && !ny && !nz) { nx = x + 0.5 - X / 2; ny = y + 0.5 - Y / 2; nz = z + 0.5 - Z / 2; if (!nx && !ny && !nz) ny = 1; }
        list.push(x, y, z, nx, ny, nz);
      }
      var total = list.length / 6, max = 70000; simplified = total > max ? Math.ceil(total / max) : 1;
      n = Math.ceil(total / simplified); pts = new Float32Array(n * 7);
      for (var k = 0, o = 0; k < total; k += simplified, o += 7) {
        var b = k * 6, L = Math.hypot(list[b + 3], list[b + 4], list[b + 5]) || 1;
        pts[o] = list[b] + 0.5 - X / 2; pts[o + 1] = list[b + 1] + 0.5 - Y / 2; pts[o + 2] = list[b + 2] + 0.5 - Z / 2;
        pts[o + 3] = list[b + 3] / L; pts[o + 4] = list[b + 4] / L; pts[o + 5] = list[b + 5] / L; pts[o + 6] = list[b + 1];
      }
      this.draw(); return { shown: n, simplified: simplified > 1 };
    };
    this.highlight = function (layer) { hl = layer; this.draw(); };
    this.reset = function () { yaw = -0.7; pitch = 0.55; zoom = 1; this.draw(); };
    this.zoomBy = function (f) { zoom = Math.max(0.3, Math.min(8, zoom * f)); this.draw(); };
    this.draw = function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; render(); }); };
    function render() {
      var r = canvas.getBoundingClientRect(), W = r.width, H = r.height, dpr = window.devicePixelRatio || 1;
      if (!W) return; canvas.width = W * dpr; canvas.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      if (!vox || !n) { g.fillStyle = '#8fa39a'; g.font = '14px Space Grotesk, sans-serif'; g.textAlign = 'center'; g.fillText(vox ? 'Nothing to show' : 'Generating…', W / 2, H / 2); return; }
      var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), span = Math.max(vox.X, vox.Y, vox.Z) * 1.75;
      var s = Math.min(W, H) / span * zoom, sz = Math.max(1.5, s * Math.pow(simplified, 1 / 2) * 1.6) /* a tilted cube covers ~1.6× its edge on screen */, order = new Uint32Array(n), depth = new Float32Array(n), px = new Float32Array(n), py = new Float32Array(n);
      for (var k = 0, o = 0; k < n; k++, o += 7) {
        var x = pts[o], y = pts[o + 1], z = pts[o + 2], x1 = x * cy - z * sy, z1 = x * sy + z * cy, y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
        px[k] = W / 2 + x1 * s; py[k] = H / 2 - y2 * s; depth[k] = z2; order[k] = k;
      }
      order.sort(function (a, b) { return depth[a] - depth[b]; }); // far first, near last
      var lx = -0.45, ly = 0.75, lz = -0.5;
      for (var t = 0; t < n; t++) {
        var k2 = order[t], o2 = k2 * 7, nx = pts[o2 + 3], ny = pts[o2 + 4], nz = pts[o2 + 5];
        var rx = nx * cy - nz * sy, rz = nx * sy + nz * cy, ry2 = ny * cp - rz * sp, rz2 = ny * sp + rz * cp;
        var lam = 0.45 + 0.55 * Math.max(0, rx * lx + ry2 * ly + rz2 * lz), c = pts[o2 + 6] === hl ? hlc : base;
        g.fillStyle = 'rgb(' + (c[0] * lam | 0) + ',' + (c[1] * lam | 0) + ',' + (c[2] * lam | 0) + ')';
        g.fillRect(px[k2] - sz / 2, py[k2] - sz / 2, sz, sz);
      }
    }
    var drag = null, pinch = null, ptrs = {};
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', function (e) { canvas.setPointerCapture(e.pointerId); ptrs[e.pointerId] = [e.clientX, e.clientY]; drag = [e.clientX, e.clientY, yaw, pitch]; });
    canvas.addEventListener('pointermove', function (e) {
      if (!ptrs[e.pointerId]) return; ptrs[e.pointerId] = [e.clientX, e.clientY]; var ids = Object.keys(ptrs);
      if (ids.length === 2) { var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) self.zoomBy(d / pinch); pinch = d; return; }
      if (drag) { yaw = drag[2] + (e.clientX - drag[0]) * 0.01; pitch = Math.max(-1.5, Math.min(1.5, drag[3] + (e.clientY - drag[1]) * 0.01)); self.draw(); }
    });
    function up(e) { delete ptrs[e.pointerId]; pinch = null; drag = null; }
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', function (e) { e.preventDefault(); self.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
    canvas.tabIndex = 0; canvas.setAttribute('role', 'img');
    canvas.addEventListener('keydown', function (e) {
      var k = { ArrowLeft: [-0.15, 0], ArrowRight: [0.15, 0], ArrowUp: [0, -0.15], ArrowDown: [0, 0.15] }[e.key];
      if (k) { e.preventDefault(); yaw += k[0]; pitch = Math.max(-1.5, Math.min(1.5, pitch + k[1])); self.draw(); }
      else if (e.key === '+' || e.key === '=') self.zoomBy(1.15); else if (e.key === '-') self.zoomBy(1 / 1.15);
    });
    window.addEventListener('resize', function () { self.draw(); });
  }

  /* ---------------- layers ---------------- */
  function layer(v, y) { var A = v.X * v.Z, o = new Uint8Array(A); o.set(v.data.subarray(y * A, y * A + A)); return o; }
  function drawLayer(g, v, y, cs, ox, oy, opts) {
    opts = opts || {}; var X = v.X, Z = v.Z, L = layer(v, y), below = y > 0 && opts.ghost !== false ? layer(v, y - 1) : null;
    g.fillStyle = '#141b18'; g.fillRect(ox, oy, X * cs, Z * cs);
    for (var z = 0; z < Z; z++) for (var x = 0; x < X; x++) {
      var i = z * X + x;
      if (L[i]) { g.fillStyle = (x + z) % 2 ? '#6fd060' : '#7bdc6a'; g.fillRect(ox + x * cs, oy + z * cs, Math.ceil(cs), Math.ceil(cs)); }
      else if (below && below[i]) { g.fillStyle = 'rgba(123,220,106,.16)'; g.fillRect(ox + x * cs, oy + z * cs, Math.ceil(cs), Math.ceil(cs)); }
    }
    if (cs >= 4) {
      g.lineWidth = 1; g.beginPath(); g.strokeStyle = 'rgba(255,255,255,.08)';
      for (var a = 0; a <= X; a++) { g.moveTo(Math.round(ox + a * cs) + 0.5, oy); g.lineTo(Math.round(ox + a * cs) + 0.5, oy + Z * cs); }
      for (var b = 0; b <= Z; b++) { g.moveTo(ox, Math.round(oy + b * cs) + 0.5); g.lineTo(ox + X * cs, Math.round(oy + b * cs) + 0.5); }
      g.stroke(); g.beginPath(); g.strokeStyle = 'rgba(255,255,255,.22)';
      for (a = 0; a <= X; a += 5) { g.moveTo(Math.round(ox + a * cs) + 0.5, oy); g.lineTo(Math.round(ox + a * cs) + 0.5, oy + Z * cs); }
      for (b = 0; b <= Z; b += 5) { g.moveTo(ox, Math.round(oy + b * cs) + 0.5); g.lineTo(ox + X * cs, Math.round(oy + b * cs) + 0.5); }
      g.stroke();
    }
    g.strokeStyle = 'rgba(242,193,78,.6)'; g.setLineDash([4, 4]); g.beginPath();
    g.moveTo(ox + X * cs / 2, oy); g.lineTo(ox + X * cs / 2, oy + Z * cs); g.moveTo(ox, oy + Z * cs / 2); g.lineTo(ox + X * cs, oy + Z * cs / 2); g.stroke(); g.setLineDash([]);
  }
  function runs(v, y) {
    var X = v.X, Z = v.Z, L = layer(v, y), out = [];
    for (var z = 0; z < Z; z++) {
      var row = [], x = 0;
      while (x < X) { if (L[z * X + x]) { var s = x; while (x < X && L[z * X + x]) x++; row.push(s === x - 1 ? 'x' + (s + 1) : 'x' + (s + 1) + '–' + x); } else x++; }
      if (row.length) out.push('  Row ' + (z + 1) + ': ' + row.join(', '));
    }
    return out;
  }
  function instructions(v, title) {
    var lines = [title, 'Size: ' + v.X + ' × ' + v.Y + ' × ' + v.Z + ' (width × height × depth). Total blocks: ' + v.count, 'Columns are numbered from the west (x1), rows from the north (row 1). Layer 1 is the bottom.', ''];
    for (var y = 0; y < v.Y; y++) { lines.push('Layer ' + (y + 1) + ' (' + v.layers[y] + ' blocks)'); lines = lines.concat(runs(v, y)); lines.push(''); }
    lines.push('Generated at chunkscout.com'); return lines.join('\n');
  }
  function layerCanvas(v, y, title) {
    var cs = Math.max(4, Math.min(24, Math.floor(1400 / Math.max(v.X, v.Z)))), pad = 30, top = 62, c = document.createElement('canvas');
    c.width = v.X * cs + pad * 2; c.height = v.Z * cs + top + pad; var g = c.getContext('2d');
    g.fillStyle = '#0e1311'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#e6efe9'; g.font = '700 18px Space Grotesk, sans-serif'; g.fillText(title + ' – layer ' + (y + 1) + ' of ' + v.Y, pad, 28);
    g.fillStyle = '#8fa39a'; g.font = '500 13px Space Grotesk, sans-serif'; g.fillText(v.layers[y] + ' blocks · faint squares = layer below · chunkscout.com', pad, 48);
    drawLayer(g, v, y, cs, pad, top, {}); return c;
  }
  function toBlob(c) { return new Promise(function (r) { c.toBlob(r, 'image/png'); }); }
  function download(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }

  /* ---------------- tiny ZIP writer (store, no compression) ---------------- */
  var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u) { var c = 0xFFFFFFFF; for (var i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) { // files: [{name, data:Uint8Array}]
    var parts = [], central = [], offset = 0, enc = new TextEncoder();
    function hdr(size) { return new DataView(new ArrayBuffer(size)); }
    files.forEach(function (f) {
      var name = enc.encode(f.name), crc = crc32(f.data), h = hdr(30);
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true); h.setUint32(14, crc, true);
      h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, name.length, true);
      parts.push(h.buffer, name, f.data);
      var c = hdr(46); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true);
      c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(c.buffer, name); offset += 30 + name.length + f.data.length;
    });
    var csize = central.reduce(function (s, p) { return s + (p.byteLength || p.length); }, 0), e = hdr(22);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [e.buffer]), { type: 'application/zip' });
  }
  async function layersZip(v, title, slug, onProgress) {
    var files = [];
    for (var y = 0; y < v.Y; y++) {
      var b = await toBlob(layerCanvas(v, y, title)); files.push({ name: slug + '/layer-' + String(y + 1).padStart(3, '0') + '.png', data: new Uint8Array(await b.arrayBuffer()) });
      if (onProgress) onProgress(y + 1, v.Y);
    }
    files.push({ name: slug + '/instructions.txt', data: new TextEncoder().encode(instructions(v, title)) });
    return zip(files);
  }


  /* ---------------- shared tool UI ----------------
     cfg: { spec(): shape spec or {error}, title(spec), slug(spec), stats(v, spec) -> text, share(spec) -> params } */
  function mountUI(cfg) {
    var $ = function (id) { return document.getElementById(id); }, viewer = new Viewer($('v3d')), cur = null, curSpec = null, ly = 0, timer = 0, busy = false, latest = 0;
    function setLayer(y) {
      if (!cur) return; ly = Math.max(0, Math.min(cur.Y - 1, y)); $('lyR').max = cur.Y; $('lyR').value = ly + 1;
      $('lyLbl').textContent = 'Layer ' + (ly + 1) + ' of ' + cur.Y + ' · ' + cur.layers[ly].toLocaleString() + ' block' + (cur.layers[ly] === 1 ? '' : 's');
      var c = $('lyCv'), box = c.parentNode.getBoundingClientRect().width || 300, cs = Math.max(1, Math.min(28, (box - 8) / Math.max(cur.X, cur.Z))), d = window.devicePixelRatio || 1;
      c.style.width = Math.ceil(cur.X * cs) + 'px'; c.style.height = Math.ceil(cur.Z * cs) + 'px'; c.width = Math.ceil(cur.X * cs * d); c.height = Math.ceil(cur.Z * cs * d);
      var g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); drawLayer(g, cur, ly, cs, 0, 0, {});
      var r = runs(cur, ly); $('lyRows').value = r.length ? r.join('\n') : '  (empty layer)';
      viewer.highlight($('hlLayer').checked ? ly : -1);
      $('lyPrev').disabled = ly === 0; $('lyNext').disabled = ly === cur.Y - 1;
    }
    function run() {
      var sp = cfg.spec(); $('vxErr').textContent = '';
      if (sp.error) { $('vxErr').textContent = sp.error; return; }
      busy = true; $('vxStat').textContent = 'Generating…'; $('vxBusy').hidden = false; var mine = ++latest;
      generate(sp).then(function (v) {
        if (mine !== latest) return; busy = false; $('vxBusy').hidden = true; cur = v; curSpec = sp;
        var info = viewer.set(v); $('v3dNote').textContent = info.simplified ? 'Large shape: the 3D preview shows a thinned-out sample of the blocks. Layers and counts are exact.' : 'Drag to rotate · scroll or pinch to zoom · arrow keys rotate';
        $('vxStat').textContent = cfg.stats(v, sp); setLayer(Math.min(ly, v.Y - 1));
      }).catch(function (e) { if (mine !== latest) return; busy = false; $('vxBusy').hidden = true; $('vxErr').textContent = 'Could not generate this shape in your browser (' + ((e && e.message) || 'error') + ').'; });
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(run, 120); }
    $('lyR').addEventListener('input', function () { setLayer(+$('lyR').value - 1); });
    $('lyPrev').onclick = function () { setLayer(ly - 1); }; $('lyNext').onclick = function () { setLayer(ly + 1); };
    $('hlLayer').addEventListener('change', function () { viewer.highlight($('hlLayer').checked ? ly : -1); });
    $('v3dReset').onclick = function () { viewer.reset(); }; $('v3dIn').onclick = function () { viewer.zoomBy(1.25); }; $('v3dOut').onclick = function () { viewer.zoomBy(0.8); };
    $('lyPng').onclick = function () { if (!cur) return; toBlob(layerCanvas(cur, ly, cfg.title(curSpec))).then(function (b) { download(b, cfg.slug(curSpec) + '-layer-' + (ly + 1) + '.png'); }); };
    $('lyTxt').onclick = function () { if (!cur) return; download(new Blob([instructions(cur, cfg.title(curSpec))], { type: 'text/plain' }), cfg.slug(curSpec) + '-instructions.txt'); };
    $('lyZip').onclick = function () {
      if (!cur || busy) return; var btn = $('lyZip'), label = btn.textContent; btn.disabled = true;
      layersZip(cur, cfg.title(curSpec), cfg.slug(curSpec), function (a, b) { btn.textContent = 'Preparing ' + a + '/' + b + '…'; })
        .then(function (z) { download(z, cfg.slug(curSpec) + '-layers.zip'); }).catch(function () { window.CS && CS.toast('Could not create the ZIP'); })
        .then(function () { btn.disabled = false; btn.textContent = label; });
    };
    if ($('vxShare')) $('vxShare').onclick = function (e) { if (curSpec && window.CS) CS.share(cfg.share(curSpec), e.target); };
    window.addEventListener('resize', function () { if (cur) setLayer(ly); });
    return { run: run, schedule: schedule };
  }

  function statText(v) {
    var best = 0, bi = 0; for (var y = 0; y < v.Y; y++) if (v.layers[y] > best) { best = v.layers[y]; bi = y; }
    var st = Math.floor(v.count / 64), rem = v.count % 64;
    return 'Size: ' + v.X + ' wide × ' + v.Y + ' tall × ' + v.Z + ' deep\nTotal blocks: ' + v.count.toLocaleString() + '\n= ' + st.toLocaleString() + ' stacks' + (rem ? ' + ' + rem : '') +
      '\n= ' + Math.ceil(Math.ceil(v.count / 64) / 27).toLocaleString() + ' shulker box' + (Math.ceil(Math.ceil(v.count / 64) / 27) === 1 ? '' : 'es') + ' of building blocks\nLayers: ' + v.Y + ' · busiest: layer ' + (bi + 1) + ' (' + best.toLocaleString() + ' blocks)';
  }
  window.CSVox = { statText: statText, mountUI: mountUI, generate: generate, Viewer: Viewer, drawLayer: drawLayer, runs: runs, instructions: instructions, layerCanvas: layerCanvas, toBlob: toBlob, download: download, zip: zip, layersZip: layersZip };
})();
