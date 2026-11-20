"""Mobile regression audit: horizontal overflow, clipped placeholders/select values, small tap targets, overlapping controls."""
import asyncio, json, sys
from playwright.async_api import async_playwright
B='http://localhost:8765'
# Usage: serve the repo (python3 -m http.server 8765) then: python3 tests/mobile_audit.py [widths]
# Needs Playwright + Chrome. Exits 1 if any page has overflow, clipped text/placeholders/dropdowns, overlaps or small touch targets.
import os
REPO=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES=['/','/tools/','/tools/building/','/tools/survival/','/tools/redstone/','/tools/player/','/tools/server/','/seed-map/','/about/','/contact/','/privacy/','/terms/']
WIDTHS=[int(w) for w in (sys.argv[1].split(',') if len(sys.argv)>1 else ['320','375','390','430','768'])]
JS=r'''() => {
 const out=[], vw=innerWidth, cv=document.createElement('canvas').getContext('2d');
 const vis=e=>{const r=e.getBoundingClientRect(),c=getComputedStyle(e);return r.width>0&&r.height>0&&c.visibility!=='hidden'&&c.display!=='none'&&!e.closest('[hidden],details:not([open])>*:not(summary)')};
 const name=e=>(e.id?'#'+e.id:e.tagName.toLowerCase()+(e.className&&typeof e.className==='string'?'.'+e.className.trim().split(/\s+/).join('.'):''));
 if(document.documentElement.scrollWidth>vw+1)out.push(['page-overflow',document.documentElement.scrollWidth+'>'+vw]);
 document.querySelectorAll('body *').forEach(e=>{if(!vis(e))return;const r=e.getBoundingClientRect();if(r.right>vw+1&&!e.closest('.mapview,.v3wrap,.bpview,.scrollx,table,.mini,[data-scroll],#map,canvas,.stchips,.chips-scroll,.lywrap'))out.push(['off-screen',name(e),Math.round(r.right)]);});
 const tw=(e,t)=>{const c=getComputedStyle(e);cv.font=c.fontStyle+' '+c.fontWeight+' '+c.fontSize+' '+c.fontFamily;return cv.measureText(t).width;};
 const inner=e=>{const c=getComputedStyle(e);return e.clientWidth-parseFloat(c.paddingLeft)-parseFloat(c.paddingRight);};
 document.querySelectorAll('input[placeholder]').forEach(e=>{if(!vis(e)||e.value)return;const w=tw(e,e.placeholder),a=inner(e);if(w>a+1)out.push(['placeholder-clipped',name(e),e.placeholder,Math.round(w)+'>'+Math.round(a)]);});
 document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color])').forEach(e=>{if(!vis(e)||!e.value)return;const w=tw(e,e.value),a=inner(e);if(w>a+1&&e.value.length<40&&!e.readOnly)out.push(['value-clipped',name(e),e.value]);});
 document.querySelectorAll('select').forEach(e=>{if(!vis(e))return;const o=e.options[e.selectedIndex];if(!o)return;const w=tw(e,o.text),a=inner(e)-4;if(w>a+1)out.push(['select-clipped',name(e),o.text,Math.round(w)+'>'+Math.round(a)]);});
 document.querySelectorAll('button,a.btn,.zoomctl button,select,input:not([type=checkbox]):not([type=radio]):not([type=range])').forEach(e=>{if(!vis(e))return;const r=e.getBoundingClientRect();if(matchMedia('(pointer:coarse)').matches&&(r.height<36||r.width<36)&&!e.closest('.prose,.site-footer,.crumbs,.hist,.sw,.presets,.stc,.tgl'))out.push(['small-target',name(e),Math.round(r.width)+'x'+Math.round(r.height)]);});
 // text escaping its box
 document.querySelectorAll('.card *,.stat *,.kv *,.hud *,.sel *,label,h1,h2,h3,.btn,button').forEach(e=>{if(!vis(e)||e.children.length||e.classList.contains('sr-only'))return;if(e.scrollWidth>e.clientWidth+2&&getComputedStyle(e).overflow!=='visible'&&!['TEXTAREA','INPUT','SELECT','CANVAS'].includes(e.tagName)&&getComputedStyle(e).textOverflow!=='ellipsis')out.push(['text-clipped',name(e),(e.textContent||'').slice(0,40)]);});
 // overlapping siblings in toolbars / control groups
 document.querySelectorAll('.toolbar,.zoomctl,.copyrow,.row,.seg,.mvz,.hud,.ctrls').forEach(g=>{const k=[...g.children].filter(vis);for(let i=0;i<k.length;i++)for(let j=i+1;j<k.length;j++){const a=k[i].getBoundingClientRect(),b=k[j].getBoundingClientRect();if(a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1&&getComputedStyle(k[i]).position!=='absolute'&&getComputedStyle(k[j]).position!=='absolute')out.push(['overlap',name(g),name(k[i]),name(k[j])]);}});
 return out;}'''
async def main():
  pages=PAGES[:]
  import os
  for d in sorted(os.listdir(os.path.join(REPO,'tools'))):
    if os.path.exists(os.path.join(REPO,'tools',d,'index.html')) and f'/tools/{d}/' not in pages: pages.append(f'/tools/{d}/')
  total=0
  async with async_playwright() as p:
    br=await p.chromium.launch(**({'executable_path':os.environ['CHROME']} if os.environ.get('CHROME') else {}),args=['--no-sandbox'])
    for w in WIDTHS:
      ctx=await br.new_context(viewport={'width':w,'height':800},device_scale_factor=2,is_mobile=w<700,has_touch=w<700)
      await ctx.route('**/*',lambda r: r.abort() if ('fonts.g' in r.request.url or 'cloudflareinsights' in r.request.url) else r.continue_())
      pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
      for u in pages:
        await pg.goto(B+u); await pg.wait_for_timeout(500)
        res=await pg.evaluate(JS)
        seen=set()
        for r in res:
          k=json.dumps(r[:3])
          if k in seen: continue
          seen.add(k); total+=1; print(w,u,*r)
      if errs: print(w,'JS ERRORS',errs)
      await ctx.close()
    await br.close()
  print('TOTAL',total)
  sys.exit(1 if total else 0)
asyncio.run(main())
