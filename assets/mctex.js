/* Reads block textures from the visitor's own Minecraft client .jar or a resource pack .zip, entirely in the browser.
   ChunkScout does not host or upload any game textures: they stay on the visitor's device (saved in local storage). */
(function () {
  'use strict';
  var KEY = 'cs_textures_v1';
  // Block name -> texture file when it isn't simply the snake_case name
  var OVERRIDE = {
    'Block of Iron': 'iron_block', 'Block of Gold': 'gold_block', 'Block of Diamond': 'diamond_block', 'Block of Emerald': 'emerald_block',
    'Block of Lapis Lazuli': 'lapis_block', 'Block of Redstone': 'redstone_block', 'Block of Coal': 'coal_block', 'Block of Copper': 'copper_block',
    'Block of Amethyst': 'amethyst_block', 'Block of Raw Iron': 'raw_iron_block', 'Block of Raw Gold': 'raw_gold_block', 'Block of Raw Copper': 'raw_copper_block',
    'Block of Netherite': 'netherite_block', 'Block of Quartz': 'quartz_block_side', 'Basalt': 'basalt_side', 'Smooth Sandstone': 'sandstone_top',
    'Snow Block': 'snow', 'Bone Block': 'bone_block_side', 'Hay Bale': 'hay_block_side', 'Dried Kelp Block': 'dried_kelp_side',
    'Smooth Red Sandstone': 'red_sandstone_top', 'Mushroom Stem': 'mushroom_stem', 'Grass Block': 'grass_block_side', 'Oak Leaves': 'oak_leaves'
  };
  function file(name) { return OVERRIDE[name] || name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }

  // ---- minimal ZIP reader (central directory + deflate via DecompressionStream) ----
  async function readZip(blob, want) {
    var buf = new Uint8Array(await blob.arrayBuffer()), dv = new DataView(buf.buffer), eocd = -1;
    for (var i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('This file is not a .jar or .zip archive.');
    var n = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true), out = {}, dec = new TextDecoder();
    for (var k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      var name = dec.decode(buf.subarray(p + 46, p + 46 + nlen)); p += 46 + nlen + elen + clen;
      if (!want(name)) continue;
      var lh = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true), data = buf.subarray(lh, lh + csize);
      if (method === 8) data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      else if (method !== 0) continue;
      out[name] = data;
    }
    return out;
  }
  function loadImg(bytes) { return new Promise(function (res, rej) { var u = URL.createObjectURL(new Blob([bytes], { type: 'image/png' })), im = new Image(); im.onload = function () { URL.revokeObjectURL(u); res(im); }; im.onerror = function () { URL.revokeObjectURL(u); rej(); }; im.src = u; }); }

  // Returns { label, count, tex: { file: { avg: '#rrggbb', url: 'data:image/png...', opaque: bool } } }
  async function importArchive(f, onProgress) {
    if (!('DecompressionStream' in window)) throw new Error('Your browser is too old to read .jar files. Try a current Chrome, Edge, Firefox or Safari.');
    var files = await readZip(f, function (nm) { return /^assets\/minecraft\/textures\/block\/[a-z0-9_]+\.png$/.test(nm); });
    var names = Object.keys(files); if (!names.length) throw new Error('No block textures found. Choose a Minecraft version .jar (from .minecraft/versions) or a resource pack .zip.');
    var c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true }), tex = {}, done = 0;
    for (var i = 0; i < names.length; i++) {
      try {
        var im = await loadImg(files[names[i]]), w = im.naturalWidth, h = Math.min(im.naturalHeight, w); // animated textures: first frame
        if (!w || w > 256) continue;
        c.width = w; c.height = h; g.clearRect(0, 0, w, h); g.drawImage(im, 0, 0);
        var d = g.getImageData(0, 0, w, h).data, r = 0, gg = 0, b = 0, cnt = 0, opaque = true;
        for (var j = 0; j < d.length; j += 4) { if (d[j + 3] < 250) { opaque = false; continue; } r += d[j]; gg += d[j + 1]; b += d[j + 2]; cnt++; }
        if (!cnt) continue;
        var hex = '#' + [r, gg, b].map(function (v) { return Math.round(v / cnt).toString(16).padStart(2, '0'); }).join('');
        var key = names[i].replace(/^.*\//, '').replace(/\.png$/, '');
        // store a 16x16 copy so local storage stays small
        var t = document.createElement('canvas'); t.width = 16; t.height = 16; var tg = t.getContext('2d'); tg.imageSmoothingEnabled = false; tg.drawImage(c, 0, 0, w, h, 0, 0, 16, 16);
        tex[key] = { avg: hex, url: t.toDataURL('image/png'), opaque: opaque };
      } catch (e) { /* skip unreadable texture */ }
      if (onProgress && ++done % 50 === 0) onProgress(done, names.length);
    }
    var label = (f.name || 'Minecraft').replace(/\.(jar|zip)$/i, '');
    var pack = { label: label, count: Object.keys(tex).length, tex: tex };
    try { localStorage.setItem(KEY, JSON.stringify(pack)); } catch (e) { pack.unsaved = true; }
    return pack;
  }
  function saved() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }
  window.CSTex = { importArchive: importArchive, saved: saved, clear: clear, file: file };
})();
