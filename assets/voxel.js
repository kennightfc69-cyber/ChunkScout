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

  /* ---------------- 3D preview (WebGL2) ---------------- */
  // Real cubes with a depth buffer, Minecraft-style face lighting, smooth ambient occlusion,
  // crisp block edges, textures, a floor grid and an optional cut-away above a chosen layer.
  function GLViewer(canvas) {
    var gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) return null;
    var self = this, yaw = -0.65, pitch = 0.6, zoom = 1, vox = null, hl = -1, cut = -1, mark = null, raf = 0, base = [122, 121, 121], texCanvas = null;
    function sh(type, src) { var o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; }
    function prog(vs, fs) { var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; }
    var P = prog('#version 300 es\nlayout(location=0)in vec3 aP;layout(location=1)in vec2 aU;layout(location=2)in float aL;layout(location=3)in float aY;uniform mat4 uM;out vec2 vU;out float vL;out float vY;out float vD;void main(){vU=aU;vL=aL;vY=aY;gl_Position=uM*vec4(aP,1.);vD=gl_Position.w;}',
      '#version 300 es\nprecision highp float;in vec2 vU;in float vL;in float vY;in float vD;uniform sampler2D uT;uniform float uHl;uniform vec3 uFog;uniform vec2 uFogR;out vec4 o;void main(){vec3 c=texture(uT,vU).rgb;c*=vL;' +
      'vec2 w=fwidth(vU);vec2 d=min(vU,1.-vU)/max(w,vec2(1e-5));float e=min(d.x,d.y);float px=1./max(max(w.x,w.y),1e-5);float edge=(1.-clamp(e-.6,0.,1.))*clamp((px-3.)/6.,0.,1.);c*=1.-.5*edge;' +
      'if(abs(vY-uHl)<.5){c=mix(c,vec3(.95,.76,.31),.5);} float f=clamp((vD-uFogR.x)/(uFogR.y-uFogR.x),0.,1.);c=mix(c,uFog,f*.55);o=vec4(c,1.);}');
    var L = prog('#version 300 es\nlayout(location=0)in vec3 aP;uniform mat4 uM;void main(){gl_Position=uM*vec4(aP,1.);}', '#version 300 es\nprecision mediump float;uniform vec4 uC;out vec4 o;void main(){o=uC;}');
    var U = { M: gl.getUniformLocation(P, 'uM'), T: gl.getUniformLocation(P, 'uT'), Hl: gl.getUniformLocation(P, 'uHl'), Fog: gl.getUniformLocation(P, 'uFog'), FogR: gl.getUniformLocation(P, 'uFogR'), LM: gl.getUniformLocation(L, 'uM'), LC: gl.getUniformLocation(L, 'uC') };
    var vao = gl.createVertexArray(), vbo = gl.createBuffer(), ibo = gl.createBuffer(), nIdx = 0;
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    [[0, 3, 0], [1, 2, 12], [2, 1, 20], [3, 1, 24]].forEach(function (a) { gl.enableVertexAttribArray(a[0]); gl.vertexAttribPointer(a[0], a[1], gl.FLOAT, false, 28, a[2]); });
    gl.bindVertexArray(null);
    var lvao = gl.createVertexArray(), lbo = gl.createBuffer(), gridN = 0; gl.bindVertexArray(lvao); gl.bindBuffer(gl.ARRAY_BUFFER, lbo); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0); gl.bindVertexArray(null);
    var tex = gl.createTexture();
    function upload(src) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([base[0], base[1], base[2], 255]));
      gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    upload(null);
    // overlay for compass letters
    var ov = document.createElement('canvas'); ov.setAttribute('aria-hidden', 'true'); ov.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
    if (canvas.parentNode) { canvas.parentNode.style.position = 'relative'; canvas.parentNode.appendChild(ov); }
    // face table: normal, tangent u axis, tangent v axis (v points down the texture), 4 corners as [u,v] in 0/1, light
    var FACES = [
      { n: [1, 0, 0], l: 0.8 }, { n: [-1, 0, 0], l: 0.8 }, { n: [0, 1, 0], l: 1.0 }, { n: [0, -1, 0], l: 0.5 }, { n: [0, 0, 1], l: 0.62 }, { n: [0, 0, -1], l: 0.62 }];
    // corners for each face in voxel-local coordinates (0..1), with texture uv
    function corners(f) {
      switch (f) {
        case 0: return [[1, 0, 1, 0, 1], [1, 0, 0, 1, 1], [1, 1, 0, 1, 0], [1, 1, 1, 0, 0]];
        case 1: return [[0, 0, 0, 0, 1], [0, 0, 1, 1, 1], [0, 1, 1, 1, 0], [0, 1, 0, 0, 0]];
        case 2: return [[0, 1, 1, 0, 1], [1, 1, 1, 1, 1], [1, 1, 0, 1, 0], [0, 1, 0, 0, 0]];
        case 3: return [[0, 0, 0, 0, 1], [1, 0, 0, 1, 1], [1, 0, 1, 1, 0], [0, 0, 1, 0, 0]];
        case 4: return [[0, 0, 1, 0, 1], [1, 0, 1, 1, 1], [1, 1, 1, 1, 0], [0, 1, 1, 0, 0]];
        default: return [[1, 0, 0, 0, 1], [0, 0, 0, 1, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]];
      }
    }
    var CORN = [0, 1, 2, 3, 4, 5].map(corners);
    function build() {
      if (!vox) return; var X = vox.X, Y = vox.Y, Z = vox.Z, D = vox.data, top = cut >= 0 ? cut : Y - 1;
      var S = function (x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < X && y <= top && z < Z && D[(y * Z + z) * X + x] ? 1 : 0; };
      var cnt = 0, x, y, z, f;
      for (y = 0; y <= top; y++) for (z = 0; z < Z; z++) for (x = 0; x < X; x++) if (D[(y * Z + z) * X + x]) for (f = 0; f < 6; f++) { var n = FACES[f].n; if (!S(x + n[0], y + n[1], z + n[2])) cnt++; }
      var V = new Float32Array(cnt * 28), I = new Uint32Array(cnt * 6), vi = 0, ii = 0, q = 0, ox = X / 2, oy = Y / 2, oz = Z / 2;
      for (y = 0; y <= top; y++) for (z = 0; z < Z; z++) for (x = 0; x < X; x++) {
        if (!D[(y * Z + z) * X + x]) continue;
        for (f = 0; f < 6; f++) {
          var F = FACES[f], nn = F.n; if (S(x + nn[0], y + nn[1], z + nn[2])) continue;
          var ao = [0, 0, 0, 0], C = CORN[f];
          for (var k = 0; k < 4; k++) {
            var c = C[k], ax = [0, 1, 2].filter(function (a) { return !nn[a]; }), d1 = [0, 0, 0], d2 = [0, 0, 0];
            d1[ax[0]] = c[ax[0]] ? 1 : -1; d2[ax[1]] = c[ax[1]] ? 1 : -1;
            var bx = x + nn[0], by = y + nn[1], bz = z + nn[2];
            var s1 = S(bx + d1[0], by + d1[1], bz + d1[2]), s2 = S(bx + d2[0], by + d2[1], bz + d2[2]), cc = S(bx + d1[0] + d2[0], by + d1[1] + d2[1], bz + d1[2] + d2[2]);
            ao[k] = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
            var lt = F.l * (0.5 + 0.5 * ao[k] / 3);
            V[vi++] = x + c[0] - ox; V[vi++] = y + c[1] - oy; V[vi++] = z + c[2] - oz; V[vi++] = c[3]; V[vi++] = c[4]; V[vi++] = lt; V[vi++] = y;
          }
          if (ao[0] + ao[2] > ao[1] + ao[3]) { I[ii++] = q; I[ii++] = q + 1; I[ii++] = q + 2; I[ii++] = q; I[ii++] = q + 2; I[ii++] = q + 3; }
          else { I[ii++] = q + 1; I[ii++] = q + 2; I[ii++] = q + 3; I[ii++] = q + 1; I[ii++] = q + 3; I[ii++] = q; }
          q += 4;
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, V, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, I, gl.STATIC_DRAW); nIdx = ii;
      // floor grid under the footprint
      var G = [], fy = -oy - 0.002, ext = 2;
      for (x = -ext; x <= X + ext; x++) G.push(x - ox, fy, -ext - oz, x - ox, fy, Z + ext - oz);
      for (z = -ext; z <= Z + ext; z++) G.push(-ext - ox, fy, z - oz, X + ext - ox, fy, z - oz);
      gridN = G.length / 3; gl.bindBuffer(gl.ARRAY_BUFFER, lbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(G), gl.DYNAMIC_DRAW);
      return cnt;
    }
    function mul(a, b) { var o = new Float32Array(16); for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) { var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; }
    function matrix(W, H) {
      var span = Math.max(vox.X, vox.Y, vox.Z), dist = span * 2.1 / zoom + 2, fov = 0.62, asp = W / H, near = Math.max(0.1, dist - span * 1.5), far = dist + span * 1.5 + 10;
      var ex = dist * Math.cos(pitch) * Math.sin(yaw), ey = dist * Math.sin(pitch), ez = dist * Math.cos(pitch) * Math.cos(yaw);
      var fz = [ex, ey, ez], fl = Math.hypot(ex, ey, ez); fz = fz.map(function (v) { return v / fl; });
      var xr = [fz[2], 0, -fz[0]], xl = Math.hypot(xr[0], xr[2]) || 1; xr = xr.map(function (v) { return v / xl; });
      var yu = [fz[1] * xr[2] - fz[2] * xr[1], fz[2] * xr[0] - fz[0] * xr[2], fz[0] * xr[1] - fz[1] * xr[0]];
      var view = new Float32Array([xr[0], yu[0], fz[0], 0, xr[1], yu[1], fz[1], 0, xr[2], yu[2], fz[2], 0, -(xr[0] * ex + xr[1] * ey + xr[2] * ez), -(yu[0] * ex + yu[1] * ey + yu[2] * ez), -(fz[0] * ex + fz[1] * ey + fz[2] * ez), 1]);
      var t = 1 / Math.tan(fov / 2), proj = new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);
      return { m: mul(proj, view), dist: dist, span: span };
    }
    function project(m, x, y, z, W, H) { var cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cw = m[3] * x + m[7] * y + m[11] * z + m[15]; return [(cx / cw * 0.5 + 0.5) * W, (1 - (cy / cw * 0.5 + 0.5)) * H, cw]; }
    function render() {
      var r = canvas.getBoundingClientRect(), W = r.width, H = r.height, dpr = Math.min(2, window.devicePixelRatio || 1); if (!W) return;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      ov.width = Math.round(W * dpr); ov.height = Math.round(H * dpr); ov.style.width = W + 'px'; ov.style.height = H + 'px'; ov.style.left = canvas.offsetLeft + 'px'; ov.style.top = canvas.offsetTop + 'px';
      var o2 = ov.getContext('2d'); o2.setTransform(dpr, 0, 0, dpr, 0, 0); o2.clearRect(0, 0, W, H);
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!vox) { o2.fillStyle = '#8fa39a'; o2.font = '14px Space Grotesk, sans-serif'; o2.textAlign = 'center'; o2.fillText('Generating…', W / 2, H / 2); return; }
      var M = matrix(W, H); gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      // grid
      gl.useProgram(L); gl.uniformMatrix4fv(U.LM, false, M.m); gl.uniform4f(U.LC, 0.55, 0.68, 0.62, 0.16); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(lvao); gl.bindBuffer(gl.ARRAY_BUFFER, lbo); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0); gl.depthMask(false); gl.drawArrays(gl.LINES, 0, gridN); gl.depthMask(true); gl.disable(gl.BLEND);
      // blocks
      gl.useProgram(P); gl.uniformMatrix4fv(U.M, false, M.m); gl.uniform1i(U.T, 0); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1f(U.Hl, hl); gl.uniform3f(U.Fog, 0.05, 0.07, 0.06); gl.uniform2f(U.FogR, M.dist - M.span * 0.2, M.dist + M.span * 1.2);
      gl.bindVertexArray(vao); if (nIdx) gl.drawElements(gl.TRIANGLES, nIdx, gl.UNSIGNED_INT, 0); gl.bindVertexArray(null);
      // marker: outlined cube drawn on top
      if (mark) {
        var mx = mark[0] - vox.X / 2, my = mark[1] - vox.Y / 2, mz = mark[2] - vox.Z / 2, e = 0.04, a0 = -e, a1 = 1 + e, cs = [];
        [[a0, a0, a0], [a1, a0, a0], [a1, a0, a1], [a0, a0, a1], [a0, a1, a0], [a1, a1, a0], [a1, a1, a1], [a0, a1, a1]].forEach(function (p) { cs.push([mx + p[0], my + p[1], mz + p[2]]); });
        var E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]], seg = [];
        E.forEach(function (ed) { seg.push.apply(seg, cs[ed[0]]); seg.push.apply(seg, cs[ed[1]]); });
        var mb = gl.createBuffer(); gl.useProgram(L); gl.bindVertexArray(lvao); gl.bindBuffer(gl.ARRAY_BUFFER, mb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(seg), gl.STREAM_DRAW); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
        gl.disable(gl.DEPTH_TEST); gl.uniform4f(U.LC, 1, 1, 1, 1); gl.drawArrays(gl.LINES, 0, 24); gl.enable(gl.DEPTH_TEST); gl.bindVertexArray(null); gl.deleteBuffer(mb);
        var c2 = project(M.m, mx + 0.5, my + 0.5, mz + 0.5, W, H); o2.strokeStyle = '#fff'; o2.lineWidth = 2; o2.beginPath(); o2.arc(c2[0], c2[1], 9, 0, 7); o2.stroke();
      }
      // compass
      o2.font = '700 13px Space Grotesk, sans-serif'; o2.textAlign = 'center'; o2.textBaseline = 'middle';
      var R = Math.max(vox.X, vox.Z) / 2 + 3, gy = -vox.Y / 2, ctr = project(M.m, 0, 0, 0, W, H), rad = Math.hypot(vox.X, vox.Y, vox.Z) / 2;
      var edgeP = project(M.m, rad * Math.cos(yaw), 0, -rad * Math.sin(yaw), W, H), srad = Math.hypot(edgeP[0] - ctr[0], edgeP[1] - ctr[1]);
      [['N', 0, -R, '#f2c14e'], ['S', 0, R, '#c9d6cf'], ['E', R, 0, '#c9d6cf'], ['W', -R, 0, '#c9d6cf']].forEach(function (c) { var p = project(M.m, c[1], gy, c[2], W, H); if (p[2] <= 0) return;
        if (p[2] > ctr[2] && Math.hypot(p[0] - ctr[0], p[1] - ctr[1]) < srad * 0.92) return; /* hidden behind the build */ o2.fillStyle = 'rgba(11,15,13,.75)'; o2.beginPath(); o2.arc(p[0], p[1], 10, 0, 7); o2.fill(); o2.fillStyle = c[3]; o2.fillText(c[0], p[0], p[1] + 0.5); });
    }
    this.set = function (v) { vox = v; build(); this.draw(); return { shown: 0, simplified: false }; };
    this.setBlock = function (b) { base = [1, 3, 5].map(function (i) { return parseInt(b.hex.substr(i, 2), 16); }); texCanvas = b.canvas || null; upload(texCanvas); this.draw(); };
    this.highlight = function (layer) { hl = layer; this.draw(); };
    this.setCut = function (layer) { if (layer === cut) return; cut = layer; build(); this.draw(); };
    this.mark = function (p) { mark = p; this.draw(); };
    this.reset = function () { yaw = -0.65; pitch = 0.6; zoom = 1; this.draw(); };
    this.zoomBy = function (f) { zoom = Math.max(0.3, Math.min(14, zoom * f)); this.draw(); };
    this.draw = function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; render(); }); };
    var drag = null, pinch = null, ptrs = {};
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', function (e) { canvas.setPointerCapture(e.pointerId); ptrs[e.pointerId] = [e.clientX, e.clientY]; drag = [e.clientX, e.clientY, yaw, pitch]; });
    canvas.addEventListener('pointermove', function (e) {
      if (!ptrs[e.pointerId]) return; ptrs[e.pointerId] = [e.clientX, e.clientY]; var ids = Object.keys(ptrs);
      if (ids.length === 2) { var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) self.zoomBy(d / pinch); pinch = d; return; }
      if (drag) { yaw = drag[2] - (e.clientX - drag[0]) * 0.01; pitch = Math.max(-1.45, Math.min(1.45, drag[3] + (e.clientY - drag[1]) * 0.01)); self.draw(); }
    });
    function up(e) { delete ptrs[e.pointerId]; pinch = null; drag = null; }
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', function (e) { e.preventDefault(); self.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
    canvas.tabIndex = 0; canvas.setAttribute('role', 'img');
    canvas.addEventListener('keydown', function (e) {
      var k = { ArrowLeft: [0.15, 0], ArrowRight: [-0.15, 0], ArrowUp: [0, 0.15], ArrowDown: [0, -0.15] }[e.key];
      if (k) { e.preventDefault(); yaw += k[0]; pitch = Math.max(-1.45, Math.min(1.45, pitch + k[1])); self.draw(); }
      else if (e.key === '+' || e.key === '=') self.zoomBy(1.15); else if (e.key === '-') self.zoomBy(1 / 1.15);
    });
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); });
    window.addEventListener('resize', function () { self.draw(); });
    return this;
  }

  /* ---------------- 3D preview (canvas fallback, for browsers without WebGL2) ---------------- */
  function Viewer(canvas, opts) {
    opts = opts || {};
    var g = canvas.getContext('2d'), self = this, yaw = -0.7, pitch = 0.55, zoom = 1, vox = null, pts = null, n = 0, simplified = 1, hl = -1, raf = 0;
    var base = opts.color || [123, 220, 106], hlc = [242, 193, 78], tex = null, texHl = null;
    // faces: +x,-x,+y,-y,+z,-z  (bit order); each face = normal + 4 corners (unit cube centred on 0)
    var FACES = [[1, 0, 0, [[.5, -.5, -.5], [.5, -.5, .5], [.5, .5, .5], [.5, .5, -.5]]], [-1, 0, 0, [[-.5, -.5, .5], [-.5, -.5, -.5], [-.5, .5, -.5], [-.5, .5, .5]]],
      [0, 1, 0, [[-.5, .5, -.5], [.5, .5, -.5], [.5, .5, .5], [-.5, .5, .5]]], [0, -1, 0, [[-.5, -.5, .5], [.5, -.5, .5], [.5, -.5, -.5], [-.5, -.5, -.5]]],
      [0, 0, 1, [[.5, -.5, .5], [-.5, -.5, .5], [-.5, .5, .5], [.5, .5, .5]]], [0, 0, -1, [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, .5, -.5], [-.5, .5, -.5]]]];
    var SHADE = [0.8, 0.8, 1, 0.5, 0.65, 0.65]; // Minecraft-style fixed face lighting: top brightest, sides darker
    this.setBlock = function (b) { // b = {hex, canvas?}
      base = [1, 3, 5].map(function (i) { return parseInt(b.hex.substr(i, 2), 16); }); tex = b.canvas || null;
      if (tex) { var c = document.createElement('canvas'); c.width = c.height = 16; var cg = c.getContext('2d'); cg.drawImage(tex, 0, 0); cg.fillStyle = 'rgba(242,193,78,.55)'; cg.fillRect(0, 0, 16, 16); texHl = c; }
      this.draw();
    };
    this.set = function (v) {
      vox = v; var X = v.X, Y = v.Y, Z = v.Z, d = v.data, list = [], i = 0, x, y, z;
      for (y = 0; y < Y; y++) for (z = 0; z < Z; z++) for (x = 0; x < X; x++, i++) {
        if (!d[i]) continue;
        var m = (x === X - 1 || !d[i + 1] ? 1 : 0) | (x === 0 || !d[i - 1] ? 2 : 0) | (y === Y - 1 || !d[i + X * Z] ? 4 : 0) | (y === 0 || !d[i - X * Z] ? 8 : 0) | (z === Z - 1 || !d[i + X] ? 16 : 0) | (z === 0 || !d[i - X] ? 32 : 0);
        if (m) list.push(x, y, z, m);
      }
      var total = list.length / 4, max = 90000; simplified = total > max ? Math.ceil(total / max) : 1;
      n = Math.ceil(total / simplified); pts = new Float32Array(n * 5);
      for (var k = 0, o = 0; k < total; k += simplified, o += 5) {
        var b = k * 4; pts[o] = list[b] + 0.5 - X / 2; pts[o + 1] = list[b + 1] + 0.5 - Y / 2; pts[o + 2] = list[b + 2] + 0.5 - Z / 2; pts[o + 3] = simplified > 1 ? 63 : list[b + 3]; pts[o + 4] = list[b + 1];
      }
      this.draw(); return { shown: n, simplified: simplified > 1 };
    };
    var mark = null;
    this.highlight = function (layer) { hl = layer; this.draw(); };
    this.mark = function (p) { mark = p; this.draw(); };
    this.reset = function () { yaw = -0.7; pitch = 0.55; zoom = 1; this.draw(); };
    this.zoomBy = function (f) { zoom = Math.max(0.3, Math.min(12, zoom * f)); this.draw(); };
    this.draw = function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; render(); }); };
    function render() {
      var r = canvas.getBoundingClientRect(), W = r.width, H = r.height, dpr = window.devicePixelRatio || 1;
      if (!W) return; canvas.width = W * dpr; canvas.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      if (!vox || !n) { g.fillStyle = '#8fa39a'; g.font = '14px Space Grotesk, sans-serif'; g.textAlign = 'center'; g.fillText(vox ? 'Nothing to show' : 'Generating…', W / 2, H / 2); return; }
      var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), span = Math.max(vox.X, vox.Y, vox.Z) * 1.75;
      var s = Math.min(W, H) / span * zoom;
      var P = function (x, y, z) { var x1 = x * cy - z * sy, z1 = x * sy + z * cy; return [W / 2 + x1 * s, H / 2 - (y * cp - z1 * sp) * s, y * sp + z1 * cp]; };
      // which faces point at the camera (orthographic, so the same for every block)
      var vis = [], f, j;
      for (f = 0; f < 6; f++) { var F = FACES[f], nz1 = F[0] * sy + F[2] * cy; if (F[1] * sp + nz1 * cp > 1e-6) vis.push(f); }
      // projected corner offsets for each visible face, relative to the block centre
      var off = vis.map(function (f) { return FACES[f][3].map(function (c) { var x1 = c[0] * cy - c[2] * sy, z1 = c[0] * sy + c[2] * cy; return [x1 * s, -(c[1] * cp - z1 * sp) * s]; }); });
      var order = new Uint32Array(n), depth = new Float32Array(n), px = new Float32Array(n), py = new Float32Array(n), k, o;
      for (k = 0, o = 0; k < n; k++, o += 5) { var p = P(pts[o], pts[o + 1], pts[o + 2]); px[k] = p[0]; py[k] = p[1]; depth[k] = p[2]; order[k] = k; }
      order.sort(function (a, b) { return depth[a] - depth[b]; }); // far first
      var faceCount = 0; for (k = 0; k < n; k++) for (j = 0; j < vis.length; j++) if (pts[k * 5 + 3] & (1 << vis[j])) faceCount++;
      var useTex = tex && s >= 5 && faceCount < 45000, edges = s >= 4, small = s < 1.2;
      var cols = vis.map(function (f) { return [base, hlc].map(function (c) { var l = SHADE[f]; return 'rgb(' + (c[0] * l | 0) + ',' + (c[1] * l | 0) + ',' + (c[2] * l | 0) + ')'; }); });
      var dark = vis.map(function (f) { return 'rgba(0,0,0,' + (1 - SHADE[f]).toFixed(2) + ')'; });
      g.lineJoin = 'round'; g.lineWidth = Math.max(0.6, Math.min(1.6, s / 12)); g.strokeStyle = 'rgba(0,0,0,.55)';
      for (var t = 0; t < n; t++) {
        k = order[t]; o = k * 5; var mask = pts[o + 3], isHl = pts[o + 4] === hl, cx = px[k], cyy = py[k];
        for (j = 0; j < vis.length; j++) {
          if (!(mask & (1 << vis[j]))) continue; var q = off[j];
          if (small) { g.fillStyle = cols[j][isHl ? 1 : 0]; g.fillRect(cx + q[0][0], cyy + q[0][1], Math.max(1, q[2][0] - q[0][0]), Math.max(1, q[2][1] - q[0][1])); continue; }
          if (useTex) {
            // affine map of the 16x16 texture onto the face parallelogram (corner0 -> corner1 is u, corner0 -> corner3 is v)
            var ux = (q[1][0] - q[0][0]) / 16, uy = (q[1][1] - q[0][1]) / 16, vx = (q[3][0] - q[0][0]) / 16, vy = (q[3][1] - q[0][1]) / 16;
            g.save(); g.beginPath(); g.moveTo(cx + q[0][0], cyy + q[0][1]); for (var c2 = 1; c2 < 4; c2++) g.lineTo(cx + q[c2][0], cyy + q[c2][1]); g.closePath(); g.clip();
            g.setTransform(ux * dpr, uy * dpr, vx * dpr, vy * dpr, (cx + q[0][0]) * dpr, (cyy + q[0][1]) * dpr); g.imageSmoothingEnabled = false;
            g.drawImage(isHl ? texHl : tex, -0.3, -0.3, 16.6, 16.6); g.restore();
            if (SHADE[vis[j]] < 1) { g.fillStyle = dark[j]; g.beginPath(); g.moveTo(cx + q[0][0], cyy + q[0][1]); for (c2 = 1; c2 < 4; c2++) g.lineTo(cx + q[c2][0], cyy + q[c2][1]); g.closePath(); g.fill(); }
            if (edges) g.stroke();
          } else {
            g.fillStyle = cols[j][isHl ? 1 : 0]; g.beginPath(); g.moveTo(cx + q[0][0], cyy + q[0][1]); for (var c3 = 1; c3 < 4; c3++) g.lineTo(cx + q[c3][0], cyy + q[c3][1]); g.closePath(); g.fill();
            if (edges) g.stroke();
          }
        }
      }
      if (mark) { var m = P(mark[0] + 0.5 - vox.X / 2, mark[1] + 0.5 - vox.Y / 2, mark[2] + 0.5 - vox.Z / 2); g.lineWidth = 2.5; g.strokeStyle = '#fff'; g.fillStyle = 'rgba(255,255,255,.45)';
        vis.forEach(function (f, j) { var q = off[j]; g.beginPath(); g.moveTo(m[0] + q[0][0], m[1] + q[0][1]); for (var c4 = 1; c4 < 4; c4++) g.lineTo(m[0] + q[c4][0], m[1] + q[c4][1]); g.closePath(); g.fill(); g.stroke(); }); }
      // compass on the ground plane
      g.font = '700 12px Space Grotesk, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      var R = Math.max(vox.X, vox.Z) / 2 + 2.5, gy = -vox.Y / 2;
      [['N', 0, -R, '#f2c14e'], ['S', 0, R, '#8fa39a'], ['E', R, 0, '#8fa39a'], ['W', -R, 0, '#8fa39a']].forEach(function (c) { var p = P(c[1], gy, c[2]); g.fillStyle = c[3]; g.fillText(c[0], p[0], p[1]); });
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
  var COL = { on: ['#7bdc6a', '#6fd060'], over: ['#f2a54e', '#e8973c'], ghost: 'rgba(123,220,106,.16)', hl: 'rgba(242,193,78,.16)' };
  function layer(v, y) { var A = v.X * v.Z, o = new Uint8Array(A); if (y >= 0 && y < v.Y) o.set(v.data.subarray(y * A, y * A + A)); return o; }
  function step(cs) { var s = [1, 2, 5, 10, 25, 50]; for (var i = 0; i < s.length; i++) if (s[i] * cs >= 18) return s[i]; return 100; }
  // geometry of a layer drawing with rulers: left/top gutters for numbers, right gutter for per-row counts
  function geom(v, cs, rulers) { var gl = rulers ? 30 : 0, gt = rulers ? 20 : 0, gr = rulers ? 34 : 0; return { gl: gl, gt: gt, w: gl + v.X * cs + gr, h: gt + v.Z * cs + (rulers ? 8 : 0) }; }
  function drawLayer(g, v, y, cs, ox, oy, opts) {
    opts = opts || {}; var X = v.X, Z = v.Z, L = layer(v, y), below = y > 0 ? layer(v, y - 1) : null, G = geom(v, cs, opts.rulers), x0 = ox + G.gl, y0 = oy + G.gt, hv = opts.hover;
    g.fillStyle = '#141b18'; g.fillRect(x0, y0, X * cs, Z * cs);
    if (hv) { g.fillStyle = COL.hl; g.fillRect(x0, y0 + hv[1] * cs, X * cs, cs); g.fillRect(x0 + hv[0] * cs, y0, cs, Z * cs); }
    for (var z = 0; z < Z; z++) for (var x = 0; x < X; x++) {
      var i = z * X + x, cx = x0 + x * cs, cy = y0 + z * cs, w = Math.ceil(cs);
      if (L[i]) { var sup = y === 0 || (below && below[i]); g.fillStyle = (sup ? COL.on : COL.over)[(x + z) % 2]; g.fillRect(cx, cy, w, w); }
      else if (below && below[i]) { g.fillStyle = COL.ghost; g.fillRect(cx, cy, w, w); }
    }
    if (cs >= 4) {
      g.lineWidth = 1; g.beginPath(); g.strokeStyle = 'rgba(255,255,255,.08)';
      for (var a = 0; a <= X; a++) { g.moveTo(Math.round(x0 + a * cs) + 0.5, y0); g.lineTo(Math.round(x0 + a * cs) + 0.5, y0 + Z * cs); }
      for (var b = 0; b <= Z; b++) { g.moveTo(x0, Math.round(y0 + b * cs) + 0.5); g.lineTo(x0 + X * cs, Math.round(y0 + b * cs) + 0.5); }
      g.stroke(); g.beginPath(); g.strokeStyle = 'rgba(255,255,255,.25)';
      for (a = 0; a <= X; a += 5) { g.moveTo(Math.round(x0 + a * cs) + 0.5, y0); g.lineTo(Math.round(x0 + a * cs) + 0.5, y0 + Z * cs); }
      for (b = 0; b <= Z; b += 5) { g.moveTo(x0, Math.round(y0 + b * cs) + 0.5); g.lineTo(x0 + X * cs, Math.round(y0 + b * cs) + 0.5); }
      g.stroke();
    }
    g.strokeStyle = 'rgba(242,193,78,.7)'; g.setLineDash([4, 4]); g.beginPath();
    g.moveTo(x0 + X * cs / 2, y0); g.lineTo(x0 + X * cs / 2, y0 + Z * cs); g.moveTo(x0, y0 + Z * cs / 2); g.lineTo(x0 + X * cs, y0 + Z * cs / 2); g.stroke(); g.setLineDash([]);
    if (hv) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(x0 + hv[0] * cs + 1, y0 + hv[1] * cs + 1, Math.max(1, cs - 2), Math.max(1, cs - 2)); }
    if (opts.rulers) {
      var st = step(cs); g.font = '600 10.5px JetBrains Mono, monospace'; g.textBaseline = 'middle';
      g.textAlign = 'center';
      for (x = 0; x < X; x++) if (x === 0 || (x + 1) % st === 0 || (hv && hv[0] === x)) { g.fillStyle = hv && hv[0] === x ? '#f2c14e' : '#8fa39a'; g.fillText(x + 1, x0 + x * cs + cs / 2, oy + 10); }
      g.textAlign = 'right';
      for (z = 0; z < Z; z++) if (z === 0 || (z + 1) % st === 0 || (hv && hv[1] === z)) { g.fillStyle = hv && hv[1] === z ? '#f2c14e' : '#8fa39a'; g.fillText(z + 1, x0 - 4, y0 + z * cs + cs / 2); }
      // per-row block counts on the right
      g.textAlign = 'left'; var cst = cs >= 10 ? 1 : st;
      for (z = 0; z < Z; z++) { if (!(z % cst === 0 || (hv && hv[1] === z))) continue; var n = 0; for (x = 0; x < X; x++) n += L[z * X + x]; if (!n) continue; g.fillStyle = hv && hv[1] === z ? '#f2c14e' : '#5c6d66'; g.fillText(n, x0 + X * cs + 5, y0 + z * cs + cs / 2); }
      g.fillStyle = '#e6efe9'; g.textAlign = 'center'; g.font = '700 10px Space Grotesk, sans-serif'; g.fillText('N', ox + 12, oy + 9);
    }
  }
  function cellRuns(L, X, z) { var out = [], x = 0; while (x < X) { if (L[z * X + x]) { var s = x; while (x < X && L[z * X + x]) x++; out.push([s, x - 1]); } else x++; } return out; }
  function runs(v, y) {
    var X = v.X, Z = v.Z, L = layer(v, y), out = [];
    for (var z = 0; z < Z; z++) {
      var r = cellRuns(L, X, z); if (!r.length) continue; var n = 0;
      out.push('  Row ' + (z + 1) + ': ' + r.map(function (p) { n += p[1] - p[0] + 1; return p[0] === p[1] ? 'x' + (p[0] + 1) : 'x' + (p[0] + 1) + '–' + (p[1] + 1) + ' (' + (p[1] - p[0] + 1) + ')'; }).join(', ') + '  = ' + n);
    }
    return out;
  }
  function describe(v, y, x, z) {
    var X = v.X, Z = v.Z, L = layer(v, y), below = layer(v, y - 1), i = z * X + x, filled = !!L[i];
    var dx = x + 0.5 - X / 2, dz = z + 0.5 - Z / 2, f = function (d, pos, neg) { return d === 0 ? 'on the centre line' : Math.abs(d) + ' ' + (d > 0 ? pos : neg); };
    var txt = 'Layer ' + (y + 1) + ' · column ' + (x + 1) + ', row ' + (z + 1) + ' · ' + f(dx, 'east', 'west') + ', ' + f(dz, 'south', 'north') + ' of the centre';
    if (!filled) return txt + ' · empty' + (below[i] ? ' (block on the layer below)' : '');
    var r = cellRuns(L, X, z).filter(function (p) { return x >= p[0] && x <= p[1]; })[0];
    return txt + ' · ' + (y === 0 || below[i] ? 'block (sits on the layer below)' : 'overhang: nothing directly below, so place it against a neighbouring block') + ' · part of a run of ' + (r[1] - r[0] + 1) + ' (columns ' + (r[0] + 1) + '–' + (r[1] + 1) + ')';
  }
  function instructions(v, title) {
    var lines = [title, 'Size: ' + v.X + ' × ' + v.Y + ' × ' + v.Z + ' (width × height × depth). Total blocks: ' + v.count,
      'Columns are numbered from the west edge (x1), rows from the north edge (row 1). Layer 1 is the bottom.', 'x5–9 (5) means place 5 blocks in columns 5 to 9 of that row.', ''];
    for (var y = 0; y < v.Y; y++) { lines.push('Layer ' + (y + 1) + ' (' + v.layers[y] + ' blocks)'); lines = lines.concat(runs(v, y)); lines.push(''); }
    lines.push('Generated at chunkscout.com'); return lines.join('\n');
  }
  function layerCanvas(v, y, title) {
    var cs = Math.max(6, Math.min(24, Math.floor(1400 / Math.max(v.X, v.Z)))), pad = 24, top = 70, G = geom(v, cs, true), c = document.createElement('canvas');
    c.width = G.w + pad * 2; c.height = G.h + top + pad; var g = c.getContext('2d');
    g.fillStyle = '#0e1311'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#e6efe9'; g.font = '700 18px Space Grotesk, sans-serif'; g.fillText(title + ' – layer ' + (y + 1) + ' of ' + v.Y, pad, 28);
    g.fillStyle = '#8fa39a'; g.font = '500 13px Space Grotesk, sans-serif';
    g.fillText(v.layers[y] + ' blocks · green = sits on the layer below · orange = overhang (nothing directly below) · faint = layer below · numbers on the right = blocks per row', pad, 50);
    drawLayer(g, v, y, cs, pad, top - 6, { rulers: true }); return c;
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
    var $ = function (id) { return document.getElementById(id); }, viewer = (function () { try { var v = new GLViewer($('v3d')); if (v && v.set) return v; } catch (e) {} return new Viewer($('v3d')); })(), cur = null, curSpec = null, ly = 0, timer = 0, busy = false, latest = 0;
    var lyZoom = 1, hover = null;
    function paintLayer() {
      var c = $('lyCv'), box = (c.parentNode.getBoundingClientRect().width || 300) - 80, fit = Math.max(1, Math.min(28, box / Math.max(cur.X, cur.Z)));
      var cs = Math.min(40, fit * lyZoom), G = geom(cur, cs, true), d = window.devicePixelRatio || 1;
      c.style.width = Math.ceil(G.w) + 'px'; c.style.height = Math.ceil(G.h) + 'px'; c.width = Math.ceil(G.w * d); c.height = Math.ceil(G.h * d);
      var g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, G.w, G.h); drawLayer(g, cur, ly, cs, 0, 0, { rulers: true, hover: hover });
      c._cs = cs; c._G = G; if ($('lyZl')) $('lyZl').textContent = Math.round(lyZoom * 100) + '%';
    }
    function setLayer(y) {
      if (!cur) return; ly = Math.max(0, Math.min(cur.Y - 1, y)); $('lyR').max = cur.Y; $('lyR').value = ly + 1;
      var L = layer(cur, ly), B = layer(cur, ly - 1), over = 0; if (ly > 0) for (var i = 0; i < L.length; i++) if (L[i] && !B[i]) over++;
      $('lyLbl').textContent = 'Layer ' + (ly + 1) + ' of ' + cur.Y + ' · ' + cur.layers[ly].toLocaleString() + ' block' + (cur.layers[ly] === 1 ? '' : 's') + (over ? ' · ' + over.toLocaleString() + ' overhang' + (over === 1 ? '' : 's') + ' (nothing directly below)' : '');
      paintLayer();
      var r = runs(cur, ly); $('lyRows').value = r.length ? r.join('\n') : '  (empty layer)';
      viewer.highlight($('hlLayer').checked ? ly : -1); if (viewer.setCut && $('cutLayer')) viewer.setCut($('cutLayer').checked ? ly : -1);
      if (hover) { $('lyInfo').textContent = describe(cur, ly, hover[0], hover[1]); viewer.mark([hover[0], ly, hover[1]]); }
      $('lyPrev').disabled = ly === 0; $('lyNext').disabled = ly === cur.Y - 1;
    }
    function pick(e) {
      if (!cur) return; var c = $('lyCv'), r = c.getBoundingClientRect(), cs = c._cs, G = c._G;
      var x = Math.floor((e.clientX - r.left - G.gl) / cs), z = Math.floor((e.clientY - r.top - G.gt) / cs);
      if (x < 0 || z < 0 || x >= cur.X || z >= cur.Z) { hover = null; $('lyInfo').textContent = 'Hover or tap a square to see exactly where it goes.'; viewer.mark(null); paintLayer(); return; }
      hover = [x, z]; $('lyInfo').textContent = describe(cur, ly, x, z); viewer.mark([x, ly, z]); paintLayer();
    }
    $('lyCv').addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse') pick(e); });
    $('lyCv').addEventListener('pointerdown', pick);
    $('lyCv').addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { hover = null; viewer.mark(null); $('lyInfo').textContent = 'Hover or tap a square to see exactly where it goes.'; paintLayer(); } });
    if ($('lyZin')) { $('lyZin').onclick = function () { lyZoom = Math.min(8, lyZoom * 1.5); if (cur) paintLayer(); }; $('lyZout').onclick = function () { lyZoom = Math.max(1, lyZoom / 1.5); if (cur) paintLayer(); }; }
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
    if ($('cutLayer')) $('cutLayer').addEventListener('change', function () { if (viewer.setCut) viewer.setCut($('cutLayer').checked ? ly : -1); });
    (function blockPicker() {
      var sel = $('v3dBlock'), B = window.CS_BLOCKS; if (!sel || !B || !window.CSPix) return;
      sel.innerHTML = B.map(function (b, i) { return '<option value="' + i + '">' + b[0] + '</option>'; }).join('');
      var saved = null; try { saved = localStorage.getItem('cs_vox_block'); } catch (e) {}
      var idx = B.findIndex(function (b) { return b[0] === (saved || 'Stone Bricks'); }); sel.value = idx < 0 ? 0 : idx;
      function apply() {
        var b = B[+sel.value], pix = CSPix.make(b[0], b[1], b[2]), pack = window.CSTex && CSTex.saved(), t = pack && pack.tex[CSTex.file(b[0])];
        viewer.setBlock({ hex: t ? t.avg : b[1], canvas: pix.canvas });
        if (t) { var im = new Image(); im.onload = function () { viewer.setBlock({ hex: t.avg, canvas: im }); }; im.src = t.url; }
        try { localStorage.setItem('cs_vox_block', b[0]); } catch (e) {}
      }
      sel.addEventListener('change', apply); apply();
    })();
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
  window.CSVox = { describe: describe, statText: statText, mountUI: mountUI, generate: generate, Viewer: Viewer, GLViewer: GLViewer, drawLayer: drawLayer, runs: runs, instructions: instructions, layerCanvas: layerCanvas, toBlob: toBlob, download: download, zip: zip, layersZip: layersZip };
})();
