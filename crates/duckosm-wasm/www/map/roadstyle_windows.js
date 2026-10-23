// roadstyle's floating windows for the roads map: Google Street View (no key) and Google 3D (with a Google Maps JavaScript API
// key). COPIED from roadstyle src/roadstyle/static/web_template.html at commit 2bccdcb (Release v0.24.2): the CSS of the windows,
// _gmLoad, _rsFloat, the Street View window, the Google 3D window, and the helpers _svLine, _svDist, _svMeasure, _svAt, _svUrlOf.
// The changes are marked "duckosm-rust:". Not copied: the Street View marker on the map (rsSetStreetViewMarker*, stubs here).
// ponytail: a copy, until roadstyle has these windows in a file of their own that both pages load (proposed to Kaveh 2026-10-23).
//
// roadstyleWindows(map, {key}) adds the windows and their map buttons; google3d(key) adds Google 3D later (a key entered after
// the start); select(line, lngLat, properties, id) is a road click:
// it puts Street View at the point of the road nearest the click, looking the way the road runs (roadstyle's rule).

const CSS = `/* Street View window (street_view="window"): floats over the map, drag by the bar, resize by the corner */
.rs-svw{position:absolute;right:calc(56px + var(--rs-side,0px));bottom:40px;width:380px;height:260px;
  min-width:220px;min-height:150px;z-index:4;display:flex;flex-direction:column;overflow:hidden;
  resize:both;background:#fff;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.3);
  font:12px/1.4 system-ui,-apple-system,sans-serif}
.rs-svw[hidden],.rs-svw [hidden]{display:none!important}
.rs-svw-bar{display:flex;align-items:center;gap:6px;padding:5px 6px 5px 10px;background:#23262d;color:#fff;
  cursor:move;user-select:none;touch-action:none}
.rs-svw-t{flex:1;font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.rs-svw-bar button{border:0;background:none;color:#fff;font:14px/1 system-ui;cursor:pointer;padding:2px 5px}
.rs-svw-bar button:disabled{opacity:.3;cursor:default}
.rs-svw iframe,.rs-svw-pano{flex:1;width:100%;border:0;background:#eee}
.rs-svw-mode{display:inline-flex;border:1px solid #555;border-radius:4px;overflow:hidden;cursor:default}
.rs-svw-bar .rs-svw-mode button{font:11px/1 system-ui;padding:3px 7px;color:#cbd5e1}
.rs-svw-bar .rs-svw-mode button.on{background:#0E7F91;color:#fff}
.rs-svw-msg{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
  padding:14px;text-align:center;color:#666;background:#f4f4f4}
.rs-svw-msg code{background:#e6e6e6;padding:1px 4px;border-radius:3px;color:#333}
.rs-svw.rs-drag iframe,.rs-svw.rs-drag .rs-svw-pano,.rs-svw.rs-drag gmp-map-3d{pointer-events:none}
.rs-g3d gmp-map-3d{flex:1;width:100%}
.rs-svw-bar a.rs-g3d-src{color:#9aa3ad;font-size:10px;text-decoration:none;white-space:nowrap}
.rs-g3d-warn{color:#fbbf24;font-size:11px;white-space:nowrap}
.maplibregl-ctrl-group button.rs-on{background:#dfe9ff}
.rs-svm{pointer-events:none}`;

export function roadstyleWindows(map, opts = {}) {
const style = document.createElement("style"); style.textContent = CSS; document.head.appendChild(style);
// duckosm-rust: the marker of roadstyle's page is not here
const rsSetStreetViewMarkerAt = () => {}, rsSetStreetViewMarker = () => {};
const _SV_LANE_M = 2.5, _SV_R = 110540;          // metres per degree of latitude
function _svLine(f){ const g=f && f.geometry;
  return !g ? [] : g.type==="LineString" ? g.coordinates : g.type==="MultiLineString" ? [].concat(...g.coordinates) : []; }
function _svDist(cs){ const k=Math.cos(cs[0][1]*Math.PI/180), d=[0];
  for(let i=1;i<cs.length;i++) d.push(d[i-1]+Math.hypot((cs[i][0]-cs[i-1][0])*k*_SV_R, (cs[i][1]-cs[i-1][1])*_SV_R));
  return d; }
function _svMeasure(f, ll){                     // metres along f to the spot nearest ll
  const cs=_svLine(f); if(cs.length<2) return null;
  const k=Math.cos(ll.lat*Math.PI/180), d=_svDist(cs); let best=0, bd=Infinity;
  for(let i=0;i+1<cs.length;i++){
    const dx=(cs[i+1][0]-cs[i][0])*k, dy=cs[i+1][1]-cs[i][1], px=(ll.lng-cs[i][0])*k, py=ll.lat-cs[i][1];
    const t=Math.max(0, Math.min(1, (px*dx+py*dy)/((dx*dx+dy*dy)||1))), q=(px-t*dx)**2+(py-t*dy)**2;
    if(q<bd){ bd=q; best=d[i]+t*(d[i+1]-d[i]); } }
  return best; }
function _svAt(f, m){                           // the spot m metres along f: {lng, lat, h, m, len}
  const cs=_svLine(f); if(cs.length<2) return null;
  const d=_svDist(cs), len=d[d.length-1]; m=Math.max(0, Math.min(len, m));
  let i=0; while(i<cs.length-2 && d[i+1]<m) i++;
  const t=(m-d[i])/((d[i+1]-d[i])||1), k=Math.cos(cs[i][1]*Math.PI/180);
  const dx=(cs[i+1][0]-cs[i][0])*k, dy=cs[i+1][1]-cs[i][1];
  const p={lng:cs[i][0]+t*(cs[i+1][0]-cs[i][0]), lat:cs[i][1]+t*(cs[i+1][1]-cs[i][1]),
           h:(Math.atan2(dx,dy)*180/Math.PI+360)%360, m:m, len:len, a:cs[i], b:cs[i+1]};
  p.c=[p.lng, p.lat];                           // on the centre line: where the map draws from
  if(f.properties && f.properties.__rs_twoway){ // (dy,-dx) points right of travel
    const n=Math.hypot(dx, dy)||1, o=_SV_LANE_M/_SV_R; p.lng += dy/n*o/k; p.lat -= dx/n*o; }
  return p; }
function _svUrlOf(p){ return 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint='+
  p.lat.toFixed(6)+','+p.lng.toFixed(6)+(p.h==null ? '' : '&heading='+Math.round(p.h)); }
// duckosm-rust: the position of the last road click {f, m} and the step buttons (roadstyle: _svPos and rsStreetViewStep)
let _svPos = null;
function rsStreetViewStep(d){
  if(!_svPos) return false;
  const len=_svDist(_svLine(_svPos.f)).at(-1);
  _svPos.m=Math.max(0, Math.min(len, _svPos.m+d));
  document.dispatchEvent(new CustomEvent("rs:streetviewmove", {detail:{streetView:_svUrlOf(_svAt(_svPos.f, _svPos.m)),
                                                                     atStart:_svPos.m<=0, atEnd:_svPos.m>=len}}));
  return true; }
// GOOGLE'S MAPS JAVASCRIPT API, loaded once for every window that needs it (Street View's Linked
// panorama, Google 3D): a page may load Google's script only once
let _gmLoading=null;
function _gmLoad(key){ return _gmLoading || (_gmLoading=new Promise((ok, no)=>{
  window.__rsGmReady=ok; const s=document.createElement("script");
  s.src="https://maps.googleapis.com/maps/api/js?key="+encodeURIComponent(key)+"&v=weekly&loading=async&callback=__rsGmReady";
  s.async=true; s.onerror=no; document.head.appendChild(s); })); }
// A FLOATING WINDOW over the map (Street View, Google 3D): dragged by its bar, resized by its corner,
// always inside the map. Its place, size and open state are remembered per PAGE in this browser:
// every map on a site shares one localStorage, and a window enlarged on a big page must not reopen
// over a small embedded one. The first open puts it in the map's bottom-right corner (left: bottom-left).
function _rsFloat(w, bar, name, left){
  const KEY=name+":"+location.pathname;
  const st=(()=>{ try{ return JSON.parse(localStorage.getItem(KEY))||{}; }catch(e){ return {}; } })();
  const save=()=>{ try{ localStorage.setItem(KEY, JSON.stringify(st)); }catch(e){} };
  if(st.w) Object.assign(w.style, {width:st.w+"px", height:st.h+"px"});
  // anchor by the top-left once visible, so the corner grip grows the window toward the pointer
  // (right/bottom anchoring grows it the other way); keep a remembered spot on this screen
  const place=()=>{
    const m=map.getContainer().getBoundingClientRect();
    // never bigger than most of the map, so the map stays clickable beside it
    const W=Math.min(w.offsetWidth, Math.max(220, m.width*0.6)), H=Math.min(w.offsetHeight, Math.max(150, m.height*0.6));
    Object.assign(w.style, {width:W+"px", height:H+"px"});
    if(st.left==null){    // first open: a bottom corner of the map, whatever panels the page adds
      st.left=left ? m.left+12 : m.right-W-56; st.top=m.bottom-H-40; }
    // ...and inside the map, whatever screen it was placed on before
    st.left=Math.max(m.left, Math.min(m.right-W, st.left)); st.top=Math.max(m.top, Math.min(m.bottom-H, st.top));
    Object.assign(w.style, {left:st.left+"px", top:st.top+"px", right:"auto", bottom:"auto"});
  };
  bar.addEventListener("pointerdown", e=>{    // drag by the title bar
    if(e.target.tagName==="BUTTON") return;
    const r=w.getBoundingClientRect(), dx=e.clientX-r.left, dy=e.clientY-r.top;
    bar.setPointerCapture(e.pointerId); w.classList.add("rs-drag");   // the iframe mustn't swallow it
    // inside the MAP, not the browser window: a page's side panel covers the rest, and a window
    // dragged under it could not be reached again
    const mv=ev=>{ const m=map.getContainer().getBoundingClientRect();
                   st.left=Math.max(m.left, Math.min(m.right-w.offsetWidth, ev.clientX-dx));
                   st.top=Math.max(m.top, Math.min(m.bottom-30, ev.clientY-dy));
                   Object.assign(w.style, {left:st.left+"px", top:st.top+"px", right:"auto", bottom:"auto"}); };
    bar.addEventListener("pointermove", mv);
    bar.addEventListener("pointerup", ()=>{ bar.removeEventListener("pointermove", mv);
      w.classList.remove("rs-drag"); save(); }, {once:true});
  });
  new ResizeObserver(()=>{ if(!w.hidden && innerWidth>520){ st.w=w.offsetWidth; st.h=w.offsetHeight; save(); } }).observe(w);
  // THE MAP CHANGED SIZE (a side panel shown again, the browser narrowed): pull the window back
  // inside it, or it sits under the panel where no one can reach it
  map.on("resize", ()=>{ if(!w.hidden && innerWidth>520){ place(); save(); } });
  return {st, save, place};
}
// Street View window (street_view="window"): hidden until the map button (or
// rsSetStreetView(true)) opens it; then a draggable, resizable window over the map that follows
// every road selection. Nothing is loaded from Google while it is closed. Whether it is open, its
// position and its size are remembered in this browser.
const _svWindow = true;   // duckosm-rust: always (no key needed)
// with a Maps JavaScript API key (street_view_key=) the window offers Linked - a real panorama that
// reports every step and turn, so the map marker walks with the viewer - beside Classic, the embed
const _svKey = opts.key || null;   // duckosm-rust: the user's key from the page (localStorage), or none
function rsSetStreetView(){}
if(_svWindow){
  const fromDisk=location.protocol==="file:";
  const w=document.createElement("div"); w.className="rs-svw"; w.hidden=true;
  w.innerHTML='<div class="rs-svw-bar"><span class="rs-svw-t">Street View</span>'+
    '<span class="rs-svw-mode" hidden><button type="button" data-m="linked" title="The map marker walks and turns with you; Google\'s street photos only">Linked</button>'+
    '<button type="button" data-m="classic" title="Google\'s plain Street View: the marker stays where you clicked">Classic</button></span>'+
    '<button type="button" data-step="-15" title="Back 15 m along the road">\u25c0</button>'+
    '<button type="button" data-step="15" title="Forward 15 m along the road">\u25b6</button>'+
    '<button type="button" title="Close">\u2715</button></div>'+
    '<div class="rs-svw-msg">Click a road to see it in Street View.</div>'+
    // duckosm-rust: credentialless, so the frame loads in a cross-origin isolated page (serve.py's COEP, for the threads)
    '<iframe title="Google Street View" allowfullscreen credentialless hidden></iframe><div class="rs-svw-pano" hidden></div>';
  document.body.appendChild(w);
  const bar=w.firstChild, ttl=w.querySelector(".rs-svw-t"), msg=w.querySelector(".rs-svw-msg"),
        fr=w.querySelector("iframe"), pdiv=w.querySelector(".rs-svw-pano"), flip=w.querySelector(".rs-svw-mode");
  const {st, save, place}=_rsFloat(w, bar, "rs-street-view-window", false);
  // Linked or Classic, remembered in this browser (the same choice as the Street View page's)
  const MODE_KEY="rs-street-view-mode";
  let mode="classic", pano=null, svc=null;
  if(_svKey){ mode="linked"; try{ mode=localStorage.getItem(MODE_KEY)||"linked"; }catch(e){}
    flip.hidden=false;
    const mark=()=>flip.querySelectorAll("button").forEach(b=>b.classList.toggle("on", b.dataset.m===mode));
    mark();
    flip.querySelectorAll("button").forEach(b=>b.onclick=()=>{
      if(b.dataset.m===mode) return;
      mode=b.dataset.m; mark(); try{ localStorage.setItem(MODE_KEY, mode); }catch(e){}
      if(mode==="classic"){ hideP(); rsSetStreetViewMarkerAt(null); }
      // the same spot in the other panel: where the viewer has walked to, where the marker stands
      if(!rsStreetViewStep(0)) show();
    }); }
  const gload=()=>_gmLoad(_svKey);
  // THE PANORAMA EXISTS ONLY WHILE IT IS ON SCREEN. One that sat hidden - Classic showing, or the
  // window closed - came back black with a single tile in a corner, and showing it again first did
  // not cure that in a real browser. So hiding it drops it, and the next Linked view builds a new one
  // inside a box that is already visible: every return is a first load, and a first load works.
  const hideP=()=>{ pdiv.hidden=true;
    if(pano){ google.maps.event.clearInstanceListeners(pano); pano.setVisible(false); pano=null; pdiv.textContent=""; } };
  const panoAt=(lat, lng, h)=>gload().then(()=>{
    const g=google.maps; svc=svc || new g.StreetViewService();
    return svc.getPanorama({location:{lat:+lat, lng:+lng}, radius:50, preference:g.StreetViewPreference.NEAREST,
                            sources:[g.StreetViewSource.GOOGLE]}).then(r=>{
      if(mode!=="linked" || w.hidden) return;   // flipped to Classic or closed while it was asked for
      const id=r.data.location.pano, pov={heading:+h||0, pitch:0};
      fr.hidden=true; msg.hidden=true; pdiv.hidden=false;
      if(pano){ pano.setPano(id); pano.setPov(pov); return; }
      pano=new g.StreetViewPanorama(pdiv, {pano:id, pov:pov, visible:true,
                                           motionTracking:false, addressControl:false, fullscreenControl:true});
      const report=()=>{ const p=pano && pano.getPosition(); if(p) rsSetStreetViewMarkerAt(p.lng(), p.lat(), pano.getPov().heading); };
      pano.addListener("position_changed", report); pano.addListener("pov_changed", report); },
      ()=>{ hideP(); msg.hidden=false; msg.textContent="No street photos within 50 m of this spot."; }); });
  let last=null, btn=null;                   // the latest road selection: {name, url}
  const esc=t=>String(t).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);
  const show=()=>{
    if(w.hidden || !last) return;
    ttl.textContent=last.name;
    if(!last.url || fromDisk){               // Google's embed stays grey in a file:// page
      fr.hidden=true; hideP(); msg.hidden=false;
      msg.innerHTML = !last.url ? "No Street View for this road." :
        "<b>Street View needs this page served, not opened from disk.</b>"+
        "<span>Run <code>python -m http.server</code> in its folder and open it from localhost.</span>"+
        '<a href="'+esc(last.url)+'" target="_blank" rel="noopener">Open this spot in Google Maps \u2197</a>';
      return; }
    // Google won't frame last.url; this is its embeddable twin (Google's "Share > Embed a map" form)
    const u=new URL(last.url), vp=u.searchParams.get("viewpoint").split(",");
    const src="https://www.google.com/maps/embed?pb=!6m7!1m6!2m2!1d"+vp[0]+"!2d"+vp[1]+
              "!3f"+(u.searchParams.get("heading")||0)+"!4f0!5f1";
    const embed=()=>{ if(fr.getAttribute("src")!==src) fr.src=src; fr.hidden=false; msg.hidden=true; hideP(); };
    if(_svKey && mode==="linked"){ fr.hidden=true; panoAt(vp[0], vp[1], u.searchParams.get("heading")||0).catch(e=>{ console.warn("rs street view:", e); embed(); }); return; }
    embed();
  };
  const steps=[...bar.querySelectorAll("button[data-step]")];
  const ends=(a, z)=>{ steps[0].disabled=!!a; steps[1].disabled=!!z; };
  steps.forEach(b=>{ b.onclick=()=>rsStreetViewStep(+b.dataset.step); });
  document.addEventListener("rs:select", e=>{
    const d=e.detail; if(d.overlay) return;  // roads only
    const p=d.properties||{}; last={name:p.name||p.highway||"Unnamed road", url:d.streetView};
    ends(false, false); show();
  });
  document.addEventListener("rs:streetviewmove", e=>{   // the step buttons: same road, new spot
    if(!last) return; last.url=e.detail.streetView; ends(e.detail.atStart, e.detail.atEnd); show();
  });
  rsSetStreetView=function(on){
    if(!on){ hideP();                          // closed: drop the panorama (see hideP)
      // and forget the road: opened again it waits for a road, not the last one (Kaveh, 2026-10-14)
      last=null; fr.hidden=true; msg.hidden=false; msg.textContent="Click a road to see it in Street View."; ttl.textContent="Street View"; }
    w.hidden=!on; if(on && innerWidth>520) place(); rsSetStreetViewMarker(!!on);
    st.open=!!on; save(); if(btn) btn.classList.toggle("rs-on", !!on); show();
    document.dispatchEvent(new CustomEvent("rs:streetviewchange", {detail:{open:!!on}}));
  };
  bar.lastChild.onclick=()=>rsSetStreetView(false);
  map.addControl({onAdd(){
    const d=document.createElement("div"); d.className="maplibregl-ctrl maplibregl-ctrl-group";
    btn=document.createElement("button"); btn.type="button"; btn.title="Street View";
    btn.innerHTML='<svg viewBox="0 0 24 24" width="17" height="17" style="display:block;margin:auto">'+
      '<circle cx="12" cy="4.5" r="3" fill="currentColor"/>'+
      '<path d="M8.5 9h7l-1.2 7h-1.8l-.6 6.5h-1.8L9.5 16H7.7z" fill="currentColor"/></svg>';
    btn.onclick=()=>rsSetStreetView(w.hidden);
    d.appendChild(btn); return d;
  }, onRemove(){}});
  // reopen a window left open last time only once the map is up: this code runs mid-script, before
  // the Street View state below exists, and throwing here stopped the page before any road was drawn
  if(st.open) map.once("load", ()=>rsSetStreetView(true));
}
window.rsSetStreetView = rsSetStreetView;
// GOOGLE 3D window (google_3d=True, with a key): Google's photorealistic 3D view in a floating window,
// opened by its map button (or rsSetGoogle3D(true)). Its camera and the map's are linked both ways:
// center = center, bearing = heading, pitch = tilt, and zoom <-> range (the metres from Google's camera
// to its center: the map's own camera distance at that zoom). A clicked road is drawn in the 3D view
// and the camera flies along it (the map follows). Google's 3D map exists only while the window is
// open: closing it drops it, as nothing is loaded from Google while it is closed.
// duckosm-rust: google3d(key) adds the window once the page has a key: at the start, or when the user enters one
let _g3dOn = false;
function google3d(key){
if(_g3dOn || !key) return;
_g3dOn = true;
function rsSetGoogle3D(){}
{
  const w=document.createElement("div"); w.className="rs-svw rs-g3d"; w.hidden=true;
  w.innerHTML='<div class="rs-svw-bar"><span class="rs-svw-t">Google 3D</span>'+
    '<span class="rs-g3d-warn" hidden title="The ground heights did not load: on a hill, the 3D view can be closer than the map">\u26a0 no ground heights</span>'+
    '<a class="rs-g3d-src" href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener"'+
    ' title="Ground heights: Terrain Tiles on AWS (Mapzen; SRTM and other sources)">heights: Mapzen</a>'+
    '<button type="button" title="Close">✕</button></div><div class="rs-svw-msg"></div>';
  document.body.appendChild(w);
  const bar=w.firstChild, ttl=w.querySelector(".rs-svw-t"), msg=w.querySelector(".rs-svw-msg");
  const {st, save, place}=_rsFloat(w, bar, "rs-google-3d-window", true);
  let m3=null, lib=null, line=null, btn=null, lastMap=0, queued=false;
  const say=html=>{ msg.innerHTML=html; msg.hidden=false; if(m3){ m3.remove(); m3=null; line=null; } };
  const SETUP='<a href="https://khoshkhah.github.io/roadstyle/guides/google-key/" target="_blank" rel="noopener">How to set up the key ↗</a>';
  const prevAuth=window.gm_authFailure;       // Google calls this when it refuses the key on this address
  window.gm_authFailure=()=>{ if(prevAuth) prevAuth();
    say("<b>Google refused the key on this page.</b><span>Add <code>"+location.origin+"/*</code> to the key's Websites list.</span>"+SETUP); };
  // the camera link
  const rad=d=>d*Math.PI/180, EARTH=40075016.686;
  const camPx=()=>map.getCanvas().clientHeight/2/Math.tan(rad(map.getVerticalFieldOfView())/2);  // the map's camera to its center, px
  // THE GROUND'S HEIGHT under the center. Google's center is in metres above SEA LEVEL, and the map's
  // center is on the ground: on a hill (Monaco, 120 m) a center at 0 m was under the ground, and Google's
  // camera came far too close. The height comes from the free Terrain Tiles on AWS (Terrarium PNGs, no
  // key, the bare ground): one zoom-14 tile per area, kept; a pixel's color is its height. Until a tile
  // is in, the last height found holds, and its arrival moves Google to the right height. The sea floor
  // counts as 0 m: the map's water is at sea level.
  const DEM_Z=14, dem=new Map(), warn=w.querySelector(".rs-g3d-warn");
  let lastGround=0;
  const ground=(lng, lat)=>{
    const n=2**DEM_Z, x=(lng+180)/360*n, y=(1-Math.log(Math.tan(rad(lat))+1/Math.cos(rad(lat)))/Math.PI)/2*n;
    const key=DEM_Z+"/"+Math.floor(x)+"/"+Math.floor(y);
    let t=dem.get(key);
    if(!t){ t={px:null}; dem.set(key, t);
      const img=new Image(); img.crossOrigin="anonymous";
      img.onload=()=>{ const c=document.createElement("canvas"); c.width=c.height=256;
        const g=c.getContext("2d", {willReadFrequently:true}); g.drawImage(img, 0, 0);
        t.px=g.getImageData(0, 0, 256, 256).data; if(m3) Object.assign(m3, toGoogle()); };
      img.onerror=()=>{ warn.hidden=false; console.warn("rs google 3d: no ground heights from", img.src); };
      img.src="https://s3.amazonaws.com/elevation-tiles-prod/terrarium/"+key+".png"; }
    if(!t.px) return lastGround;
    const i=(Math.min(255, Math.floor(x%1*256))+Math.min(255, Math.floor(y%1*256))*256)*4;
    return lastGround=Math.max(0, t.px[i]*256+t.px[i+1]+t.px[i+2]/256-32768); };
  const toGoogle=()=>{ const c=map.getCenter();
    return {center:{lat:c.lat, lng:c.lng, altitude:ground(c.lng, c.lat)}, heading:(map.getBearing()+360)%360, tilt:map.getPitch(),
            range:camPx()*EARTH*Math.cos(rad(c.lat))/(512*Math.pow(2, map.getZoom()))}; };
  const toMap=()=>{ const c=m3.center;
    return {center:[c.lng, c.lat], bearing:m3.heading||0, pitch:m3.tilt||0,
            zoom:Math.log2(EARTH*Math.cos(rad(c.lat))*camPx()/(512*m3.range))}; };
  const turn=(a, b)=>Math.abs(((a-b)%360+540)%360-180);
  const there=t=>{ const c=map.getCenter();     // the map is already at t: Google's change came from the map
    return Math.abs(c.lng-t.center[0])<1e-7 && Math.abs(c.lat-t.center[1])<1e-7 && turn(map.getBearing(), t.bearing)<0.05 &&
           Math.abs(map.getPitch()-t.pitch)<0.05 && Math.abs(map.getZoom()-t.zoom)<0.002; };
  map.on("move", e=>{                          // the map moved (mouse, keys, buttons): Google follows
    if(!m3 || e.rsG3d) return;
    lastMap=performance.now(); Object.assign(m3, toGoogle()); });
  const fromGoogle=()=>{                       // Google moved: the map follows, once a frame
    if(queued) return; queued=true;
    requestAnimationFrame(()=>{ queued=false;
      // Google's late reports of a map move would pull the map back while it is dragged
      if(!m3 || !m3.center || !m3.range || performance.now()-lastMap<300) return;
      const t=toMap(); if(there(t)) return;
      map.jumpTo(t, {rsG3d:true});
      // THE MAP IS THE JUDGE: where it cannot follow (its maxBounds box, its maximum pitch) it stops at
      // its limit, and Google goes back to the map's camera. Google's own bounds limit the position of
      // its camera, not the point it looks at: a tilted, far camera left the box and moved the view.
      if(!there(t)) Object.assign(m3, toGoogle()); }); };
  // THE MAP'S CENTER BESIDE THE WINDOW: while the window is open, the map's padding puts its center (the
  // point the two cameras share, where a clicked road comes to) in the middle of the map's free side, so
  // the window does not cover it. Phones keep the plain center: there the window docks at the bottom.
  const pad=()=>{
    const m=map.getContainer().getBoundingClientRect(), r=w.getBoundingClientRect(), p={...map.getPadding(), left:0, right:0};
    if(!w.hidden && innerWidth>520){
      if(r.left+r.width/2 < m.left+m.width/2) p.left=Math.max(0, r.right-m.left);
      else p.right=Math.max(0, m.right-r.left); }
    const o=map.getPadding();
    if(Math.abs(o.left-p.left)>1 || Math.abs(o.right-p.right)>1) map.easeTo({padding:p, duration:300});
  };
  new ResizeObserver(pad).observe(w);          // opened, closed or resized
  bar.addEventListener("pointerup", pad);      // dragged
  map.on("resize", pad);
  const open=()=>{
    if(location.protocol==="file:"){
      say("<b>Google 3D needs this page served, not opened from disk.</b>"+
          "<span>Run <code>python -m http.server</code> in its folder and open it from an address in the key's Websites list.</span>"+SETUP);
      return; }
    msg.textContent="Loading Google 3D…"; msg.hidden=false;
    // duckosm-rust: key, not _svKey
    _gmLoad(key).then(()=>google.maps.importLibrary("maps3d")).then(l=>{
      if(w.hidden || m3) return;               // closed while it loaded
      lib=l; m3=new l.Map3DElement(Object.assign(toGoogle(), {mode:l.MapMode.HYBRID}));
      for(const ev of ["gmp-centerchange", "gmp-headingchange", "gmp-tiltchange", "gmp-rangechange"]) m3.addEventListener(ev, fromGoogle);
      msg.hidden=true; w.appendChild(m3);
    }).catch(e=>{ console.warn("rs google 3d:", e); say("<b>Google 3D did not load.</b><span>"+String(e.message||e)+"</span>"+SETUP); });
  };
  document.addEventListener("rs:select", e=>{  // a road: draw it in the 3D view and fly along it
    const d=e.detail; if(d.overlay || !m3) return;
    const cs=d.coords || []; if(cs.length<2) return;   // duckosm-rust: the page gives the road's line (from DuckDB)
    const p=d.properties||{}; ttl.textContent=p.name||p.highway||"Unnamed road";
    if(line) line.remove();
    line=new lib.Polyline3DElement({path:cs.map(c=>({lat:c[1], lng:c[0]})), strokeColor:"#7c4dff"   /* duckosm-rust: the look's selection color */, strokeWidth:8,
                                    outerColor:"#ffffff", outerWidth:0.3, drawsOccludedSegments:true});
    m3.appendChild(line);
    const dist=_svDist(cs), len=dist[dist.length-1], mid=_svAt({geometry:{type:"LineString", coordinates:cs}}, len/2);
    m3.flyCameraTo({endCamera:{center:{lat:mid.lat, lng:mid.lng, altitude:ground(mid.lng, mid.lat)}, heading:mid.h, tilt:62, range:Math.max(180, len*1.6)},
                    durationMillis:1500});
  });
  rsSetGoogle3D=function(on){
    w.hidden=!on;
    if(on){ if(innerWidth>520) place(); if(!m3) open(); }
    else { if(m3){ m3.remove(); m3=null; line=null; } ttl.textContent="Google 3D"; }
    st.open=!!on; save(); if(btn) btn.classList.toggle("rs-on", !!on);
    document.dispatchEvent(new CustomEvent("rs:google3dchange", {detail:{open:!!on}}));
  };
  bar.lastChild.onclick=()=>rsSetGoogle3D(false);
  map.addControl({onAdd(){
    const d=document.createElement("div"); d.className="maplibregl-ctrl maplibregl-ctrl-group";
    btn=document.createElement("button"); btn.type="button"; btn.title="Google 3D";
    btn.innerHTML='<svg viewBox="0 0 24 24" width="17" height="17" style="display:block;margin:auto" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">'+
      '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/></svg>';
    btn.onclick=()=>rsSetGoogle3D(w.hidden);
    d.appendChild(btn); return d;
  }, onRemove(){}});
  if(st.open) map.once("load", ()=>rsSetGoogle3D(true));
}
window.rsSetGoogle3D = rsSetGoogle3D;
}
google3d(_svKey);
// duckosm-rust: a road click of the page
function select(line, lngLat, properties, id){
  const f={type:"Feature", geometry:{type:"LineString", coordinates:line}, properties};
  const m=line.length>1 ? _svMeasure(f, lngLat) : null, p=m==null ? null : _svAt(f, m);
  _svPos=m==null ? null : {f, m};
  document.dispatchEvent(new CustomEvent("rs:select", {detail:{properties, streetView:_svUrlOf(p || lngLat), id, coords:line}}));
}
return { select, google3d };
}
