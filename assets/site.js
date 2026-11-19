/* ChunkScout shared script: nav, search, favorites, recently used, copy buttons, footer, consent.
   Page/tool list lives in /assets/data.js (window.CS_DATA). */
window.CS_CONFIG = {
  // Fill these in only after you have the accounts. Leave empty to keep ChunkScout cookie-free.
  ga4: '',          // e.g. 'G-XXXXXXXXXX'  (Google Analytics 4 measurement ID). Ads are configured in /assets/ads-config.js
  contactEmail: 'contact@chunkscout.com'
};
(function () {
  'use strict';
  var D = window.CS_DATA || { pages: [] }, C = window.CS_CONFIG;
  var $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var store = {
    get: function (k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  var byId = {}; D.pages.forEach(function (p) { byId[p.id] = p; });
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  document.documentElement.classList.remove('no-js');

  /* ---------- toast + copy ---------- */
  var toastEl;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'cs-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toastEl._t); toastEl._t = setTimeout(function () { toastEl.classList.remove('on'); }, 1500);
  }
  function copy(text, btn) {
    var done = function () { toast('Copied to clipboard'); if (btn) { var o = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(function () { btn.textContent = o; }, 1200); } };
    var fallback = function () {
      var t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} document.body.removeChild(t); ok ? done() : toast('Select the text and copy it manually');
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-copy]'); if (!b) return;
    var t = document.getElementById(b.getAttribute('data-copy')); if (!t) return;
    copy('value' in t && t.tagName !== 'DIV' ? t.value : t.textContent, b);
  });

  /* ---------- favorites + recent ---------- */
  var favs = store.get('cs_favs', []), recent = store.get('cs_recent', []);
  function isFav(id) { return favs.indexOf(id) >= 0; }
  function toggleFav(id) {
    favs = isFav(id) ? favs.filter(function (x) { return x !== id; }) : [id].concat(favs);
    store.set('cs_favs', favs); syncFavs(); renderLists();
    toast(isFav(id) ? 'Added to favorites' : 'Removed from favorites');
  }
  function syncFavs() {
    $$('[data-fav]').forEach(function (b) {
      var on = isFav(b.getAttribute('data-fav')); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (b.classList.contains('favbtn')) b.innerHTML = (on ? '★ Favorited' : '☆ Add to favorites');
      else b.textContent = on ? '★' : '☆';
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-fav]'); if (!b) return;
    e.preventDefault(); e.stopPropagation(); toggleFav(b.getAttribute('data-fav'));
  });
  var tool = document.body.getAttribute('data-tool');
  if (tool && byId[tool]) { recent = [tool].concat(recent.filter(function (x) { return x !== tool && byId[x]; })).slice(0, 6); store.set('cs_recent', recent); }

  function iconSVG(p) { return p.icon ? '<svg class="ic" viewBox="0 0 8 8" aria-hidden="true"><use href="/assets/icons.svg#' + p.icon + '"/></svg>' : ''; }
  function card(p) {
    return '<div class="tcard">' + iconSVG(p) + '<span><b><a href="' + p.url + '">' + esc(p.title) + '</a></b><small>' + esc(p.desc) + '</small>' +
      '<span class="cat">' + esc(p.cat) + (p.isNew ? ' · <span class="new">New</span>' : '') + '</span></span>' +
      (p.type === 'tool' ? '<button class="fav" type="button" data-fav="' + p.id + '" aria-pressed="false" aria-label="Favorite ' + esc(p.title) + '">☆</button>' : '') + '</div>';
  }
  function renderLists() {
    $$('[data-list]').forEach(function (el) {
      var kind = el.getAttribute('data-list'), ids = kind === 'favs' ? favs : recent.filter(function (x) { return x !== tool; });
      var items = ids.map(function (i) { return byId[i]; }).filter(Boolean).slice(0, kind === 'recent' ? 4 : 12);
      el.innerHTML = items.map(card).join('');
      var wrap = el.closest('[data-list-wrap]'); if (wrap) wrap.hidden = !items.length;
    });
    syncFavs();
  }

  /* ---------- search ---------- */
  function search(q) {
    q = q.toLowerCase().trim(); var terms = q.split(/\s+/).filter(Boolean);
    if (!terms.length) return D.pages.filter(function (p) { return p.type === 'tool'; }).slice(0, 8);
    return D.pages.map(function (p) {
      var t = p.title.toLowerCase(), k = (p.tags || '').toLowerCase(), d = p.desc.toLowerCase(), s = 0;
      for (var i = 0; i < terms.length; i++) {
        var w = terms[i], ts = 0;
        if (t.indexOf(w) === 0 || t.indexOf(' ' + w) >= 0) ts = 6; else if (t.indexOf(w) >= 0) ts = 4;
        if (k.indexOf(w) >= 0) ts = Math.max(ts, 3); if (d.indexOf(w) >= 0) ts = Math.max(ts, 1);
        if (!ts) return null; s += ts;
      }
      return { p: p, s: s + (p.type === 'tool' ? 0.5 : 0) };
    }).filter(Boolean).sort(function (a, b) { return b.s - a.s; }).map(function (r) { return r.p; }).slice(0, 10);
  }
  function wireSearch(input, list, opts) {
    var act = 0, res = [];
    function draw() {
      res = search(input.value); act = Math.min(act, Math.max(0, res.length - 1));
      list.innerHTML = res.length ? res.map(function (p, i) {
        return '<li><a href="' + p.url + '" id="' + list.id + '-' + i + '"' + (i === act ? ' class="act" aria-selected="true"' : '') + ' role="option">' + iconSVG(p) +
          '<span><b>' + esc(p.title) + '</b><small>' + esc(p.desc) + '</small></span><span class="tag">' + esc(p.type === 'tool' ? 'Tool' : p.cat) + '</span></a></li>';
      }).join('') : '<li class="sr-empty">No matches for “' + esc(input.value) + '”. Try “portal”, “circle” or “slime”.</li>';
      input.setAttribute('aria-activedescendant', res.length ? list.id + '-' + act : '');
      if (opts && opts.onDraw) opts.onDraw(res);
    }
    input.addEventListener('input', function () { act = 0; draw(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!res.length) return; act = (act + (e.key === 'ArrowDown' ? 1 : -1) + res.length) % res.length; draw(); var a = $('#' + list.id + '-' + act); if (a) a.scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter') { e.preventDefault(); if (res[act]) location.href = res[act].url; else if (input.value.trim()) location.href = '/tools/?q=' + encodeURIComponent(input.value.trim().slice(0, 64)); }
    });
    return draw;
  }
  var dlg;
  function openSearch() {
    if (!dlg) {
      dlg = document.createElement('dialog'); dlg.className = 'cs-search'; dlg.setAttribute('aria-label', 'Search ChunkScout');
      dlg.innerHTML = '<form method="dialog" role="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>' +
        '<input type="search" placeholder="Search tools and pages…" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="sr-dlg" autocomplete="off"><button class="x" value="close" type="submit">Esc</button></form>' +
        '<ul class="sr-list" id="sr-dlg" role="listbox"></ul><div class="sr-hint"><span><span class="kbd">↑</span> <span class="kbd">↓</span> to move</span><span><span class="kbd">Enter</span> to open</span></div>';
      document.body.appendChild(dlg);
      dlg._draw = wireSearch($('input', dlg), $('#sr-dlg', dlg));
      dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    }
    var inp = $('input', dlg); inp.value = ''; dlg._draw();
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); inp.focus();
  }
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-search-open]')) { e.preventDefault(); openSearch(); } });
  document.addEventListener('keydown', function (e) {
    var typing = /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.target.isContentEditable;
    var k = typeof e.key === 'string' ? e.key : '';
    if ((k === '/' && !typing) || (k.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); openSearch(); }
  });
  $$('[data-search-inline]').forEach(function (inp) {
    var list = document.getElementById(inp.getAttribute('aria-controls')); if (!list) return;
    var box = inp.closest('.hero-search'), draw = wireSearch(inp, list, { onDraw: function () { if (box) box.classList.toggle('open', !!inp.value.trim()); } });
    inp.addEventListener('focus', function () { if (inp.value.trim()) draw(); });
    document.addEventListener('click', function (e) { if (box && !box.contains(e.target)) box.classList.remove('open'); });
    var f = inp.closest('form'); if (f) f.addEventListener('submit', function (e) { e.preventDefault(); var v = inp.value.trim(), r = v ? search(v) : []; location.href = r[0] ? r[0].url : '/tools/' + (v ? '?q=' + encodeURIComponent(v.slice(0, 64)) : ''); });
  });

  /* ---------- nav ---------- */
  var menu = $('.sh-menu'), nav = $('#site-nav');
  if (menu && nav) {
    menu.addEventListener('click', function () { var o = nav.classList.toggle('open'); menu.setAttribute('aria-expanded', o ? 'true' : 'false'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && nav.classList.contains('open')) { nav.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); menu.focus(); } });
  }
  var path = location.pathname;
  var navLinks = $$('#site-nav a'), best = null;
  navLinks.forEach(function (a) { var h = a.getAttribute('href'); if (a.hasAttribute('data-exact') ? path === h : (h !== '/' && path.indexOf(h) === 0)) { if (!best || h.length > best.getAttribute('href').length) best = a; } });
  if (!best && /^\/tools\/[^/]+\/$/.test(path) && document.body.getAttribute('data-tool')) { var cat = (byId[document.body.getAttribute('data-tool')] || {}).cat; navLinks.forEach(function (a) { if (a.textContent === (cat || '').split(' ')[0]) best = a; }); }
  if (best) best.setAttribute('aria-current', 'page');

  /* ---------- footer (one place to edit for every page) ---------- */
  var ft = $('[data-footer]');
  if (ft) {
    var tools = D.pages.filter(function (p) { return p.type === 'tool'; });
    var li = function (p) { return '<li><a href="' + p.url + '">' + esc(p.short || p.title) + '</a></li>'; };
    ft.innerHTML = '<div class="sf-in"><div><a class="brand" href="/"><span class="logo" aria-hidden="true"><i class="on"></i><i></i><i class="on"></i><i></i><i class="on"></i><i></i><i class="on"></i><i></i><i class="on"></i></span>ChunkScout</a>' +
      '<p>Free Minecraft tools for Java and Bedrock players. Everything on this site runs in your browser, and you don’t need an account.</p></div>' +
      (function () { var by = function (c) { return tools.filter(function (p) { return c.indexOf(p.cat) >= 0; }); };
        return '<div><h2>Building</h2><ul>' + by(['Building']).map(li).join('') + '</ul></div>' +
          '<div><h2>Survival</h2><ul>' + by(['Survival']).map(li).join('') + '</ul></div>' +
          '<div><h2>Technical, player &amp; server</h2><ul>' + by(['Redstone & Technical', 'Player', 'Server']).map(li).join('') + '<li><a href="/tools/">All tools →</a></li></ul></div>'; })() +
      '<div><h2>ChunkScout</h2><ul><li><a href="/about/">About</a></li><li><a href="/contact/">Contact</a></li><li><a href="/privacy/">Privacy Policy</a></li><li><a href="/terms/">Terms of Use</a></li><li><a href="/sitemap.xml">Sitemap</a></li></ul></div></div>' +
      '<div class="sf-legal"><span>© ' + new Date().getFullYear() + ' ChunkScout. Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.</span>' +
      (((window.CS_CONFIG || {}).ga4 || ((window.CS_ADS || {}).enabled && !(window.CS_ADS || {}).useGoogleConsent)) ? '<button type="button" data-consent-open>Cookie settings</button>' : '') + '</div>';
  }

  /* ---------- reveal on scroll ---------- */
  var rv = $$('.rv');
  if ('IntersectionObserver' in window && rv.length) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }); }, { rootMargin: '0px 0px -40px 0px' });
    rv.forEach(function (el) { io.observe(el); });
  } else rv.forEach(function (el) { el.classList.add('in'); });

  /* ---------- consent + optional analytics (inactive until configured) ---------- */
  var A = window.CS_ADS || { enabled: false, slots: {}, sponsors: [] };
  var adsOn = !!(A.enabled && /^ca-pub-\d{10,20}$/.test(A.publisherId || ''));
  var needBanner = !!C.ga4 || (adsOn && !A.useGoogleConsent);
  function loadScript(src, cross) { if (document.querySelector('script[src="' + src + '"]')) return; var s = document.createElement('script'); s.async = true; s.src = src; if (cross) s.crossOrigin = 'anonymous'; document.head.appendChild(s); }
  function applyConsent(ok) {
    if (ok && C.ga4 && !window.gtag) {
      loadScript('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(C.ga4));
      window.dataLayer = window.dataLayer || []; window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag('js', new Date()); window.gtag('config', C.ga4, { anonymize_ip: true });
    }
    renderAds(ok || !!A.useGoogleConsent);
  }
  function consentBanner() {
    var old = $('.cs-consent'); if (old) old.remove();
    var b = document.createElement('div'); b.className = 'cs-consent'; b.setAttribute('role', 'dialog'); b.setAttribute('aria-label', 'Cookie choices');
    b.innerHTML = '<p>ChunkScout would like to use cookies for ' + (adsOn && !A.useGoogleConsent ? 'ads and ' : '') + 'anonymous usage statistics. The tools work the same either way. <a href="/privacy/">Privacy Policy</a></p>' +
      '<div class="row"><button type="button" data-c="0">Decline</button><button type="button" class="primary" data-c="1">Accept</button></div>';
    document.body.appendChild(b);
    $$('button', b).forEach(function (btn) { btn.addEventListener('click', function () { var ok = btn.getAttribute('data-c') === '1'; store.set('cs_consent', ok ? 'yes' : 'no'); b.remove(); applyConsent(ok); }); });
  }

  /* ---------- AdSlot renderer ----------
     Markup: <div class="ad-slot" data-ad="tool-bottom" data-format="horizontal" hidden></div>
     A slot only appears when it has a sponsor (labelled "Sponsored") or AdSense is fully configured for it
     (labelled "Advertisement"). Otherwise it stays hidden, so pages never show empty or fake ads. */
  var adsPushed = false;
  function safeUrl(u) { return /^(https:\/\/|\/)/.test(u || '') ? u : ''; }
  function renderAds(consentOk) {
    var ptype = document.body.getAttribute('data-page') || 'page';
    $$('.ad-slot[data-ad]').forEach(function (el) {
      if (el.getAttribute('data-filled')) return;
      var id = el.getAttribute('data-ad'), cfg = (A.slots || {})[id] || {};
      var sp = (A.sponsors || []).filter(function (x) { return x && x.slot === id && x.active !== false && safeUrl(x.url); })[0];
      var show = false;
      if (sp) {
        el.innerHTML = '<span class="ad-label">Sponsored</span><div class="ad-box" style="min-height:0"><a class="sponsor" href="' + esc(safeUrl(sp.url)) + '" rel="sponsored noopener" target="_blank">' +
          (safeUrl(sp.image) ? '<img src="' + esc(safeUrl(sp.image)) + '" alt="" loading="lazy" width="64" height="64">' : '') + '<span><b>' + esc(sp.title || '') + '</b><small>' + esc(sp.text || '') + '</small></span></a></div>';
        show = true;
      } else if (adsOn && consentOk && cfg.enabled && /^\d{6,}$/.test(cfg.unit || '') && (A.pages || {})[ptype] && !(cfg.format === 'sidebar' && !A.sidebar)) {
        el.innerHTML = '<span class="ad-label">Advertisement</span><div class="ad-box"><ins class="adsbygoogle" style="display:block" data-ad-client="' + esc(A.publisherId) + '" data-ad-slot="' + esc(cfg.unit) + '" data-ad-format="auto" data-full-width-responsive="true"></ins></div>';
        loadScript('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(A.publisherId), true);
        try { (window.adsbygoogle = window.adsbygoogle || []).push({}); adsPushed = true; } catch (e) {}
        show = true;
      }
      if (show) { el.hidden = false; el.setAttribute('data-filled', '1'); var w = el.closest('[data-aside-wrap]'); if (w) w.classList.add('has-aside'); }
    });
  }
  if (needBanner) {
    var c = store.get('cs_consent', null);
    if (c === null) { consentBanner(); renderAds(!!A.useGoogleConsent); } else applyConsent(c === 'yes');
    document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-consent-open]')) consentBanner(); });
  } else renderAds(true);
  /* Tool usage event (only sent if GA4 is configured and accepted) */
  /* Shareable links: only the tool's own settings go in the URL, never personal data. */
  function shareLink(params, btn) {
    var u = new URL(location.href); u.search = ''; u.hash = '';
    Object.keys(params).forEach(function (k) { if (params[k] !== '' && params[k] != null) u.searchParams.set(k, params[k]); });
    copy(u.toString(), btn); return u.toString();
  }
  function params() { var o = {}; new URLSearchParams(location.search).forEach(function (v, k) { o[k] = v.slice(0, 64); }); return o; }
  window.CS = { copy: copy, toast: toast, store: store, search: search, share: shareLink, params: params, track: function (n, p) { if (window.gtag) window.gtag('event', n, p || {}); } };

  renderLists();
})();
/* Sticky shorter column: when one side of a two-column tool is much shorter, keep it in view while the other scrolls. */
(function () {
  function upd() {
    var mob = window.matchMedia('(max-width:820px)').matches;
    document.querySelectorAll('.tool').forEach(function (t) {
      var k = Array.prototype.filter.call(t.children, function (c) { return c.offsetParent !== null; });
      k.forEach(function (c) { c.classList.remove('stick'); });
      if (mob || k.length !== 2) return;
      var a = k[0].getBoundingClientRect().height, b = k[1].getBoundingClientRect().height, s = a < b ? k[0] : k[1], sh = Math.min(a, b), lg = Math.max(a, b);
      if (lg - sh > 120 && sh < window.innerHeight - 96) s.classList.add('stick');
    });
  }
  var t = 0; function later() { clearTimeout(t); t = setTimeout(upd, 120); }
  window.addEventListener('load', upd); window.addEventListener('resize', later);
  if (window.ResizeObserver) document.addEventListener('DOMContentLoaded', function () { var ro = new ResizeObserver(later); document.querySelectorAll('.tool,.tool>*').forEach(function (e) { ro.observe(e); }); });
})();
