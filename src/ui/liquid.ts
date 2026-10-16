/**
 * The living layer under and on the glass, inlined at the top of <body> so it
 * runs before the first paint (and before React):
 *
 * - A WebGL mesh gradient: five soft lights on slow orbits, their edges
 *   bent by a two-step domain warp so the colors flow like liquid. It is drawn
 *   once synchronously, so the first frame and every view-transition snapshot
 *   already show it; the phase comes from the wall clock, so moving between
 *   pages does not restart it. Rendered at half resolution and 30 fps, paused
 *   in hidden tabs, a single still frame under reduced motion, and the CSS
 *   lights on body::before stay as the fallback when WebGL is missing or lost.
 * - Real refraction for the panels that float over the background only (the
 *   sidebar, the login panels; elements with data-lens, wide screens): inside
 *   their rounded rectangles the shader reads the background from further
 *   out near the edge, as a thick glass edge bends light, splits it slightly
 *   by color, and adds the specular highlight on the bevel facing the light
 *   (the pointer). Those panels then drop their CSS backdrop (html.lg-lens).
 * - Pointer light for the glass: the hovered surface and control get --mx/--my
 *   (the pointer in their own box) so the specular rim and the inner glow sit
 *   where the light is, and products get --tx/--ty (-1..1) for a small
 *   parallax of the photo.
 * - Scroll state on <html>: data-scrolled once the page leaves the top, and
 *   data-scroll="down" while scrolling down (the phone tab bar tucks in).
 *
 * Self-contained on purpose: it is serialized with Function#toString.
 */
function liquid() {
  var doc = document;
  var root = doc.documentElement;
  var win = window;
  var reduceMq = win.matchMedia('(prefers-reduced-motion: reduce)');
  var darkMq = win.matchMedia('(prefers-color-scheme: dark)');
  var coarse = win.matchMedia('(pointer: coarse)').matches;

  /* ---- pointer light on glass surfaces ---------------------------------- */
  var SURFACE = '.card, .glass, .pane';
  var CONTROL =
    '.btn, .chip, .nav a, .tabs a, .demo-user, .theme-switch button, .icon-btn, .order-row';
  var pending: PointerEvent | null = null;
  function place(el: Element, e: PointerEvent, parallax: boolean) {
    var r = el.getBoundingClientRect();
    var s = (el as HTMLElement).style;
    var x = e.clientX - r.left;
    var y = e.clientY - r.top;
    s.setProperty('--mx', x.toFixed(1) + 'px');
    s.setProperty('--my', y.toFixed(1) + 'px');
    if (parallax && r.width && r.height) {
      s.setProperty('--tx', ((x / r.width) * 2 - 1).toFixed(3));
      s.setProperty('--ty', ((y / r.height) * 2 - 1).toFixed(3));
    }
  }
  function light() {
    var e = pending;
    pending = null;
    if (!e || !(e.target instanceof Element)) return;
    var surface = e.target.closest(SURFACE);
    var control = e.target.closest(CONTROL);
    if (surface)
      place(
        surface,
        e,
        !reduceMq.matches && surface.classList.contains('product'),
      );
    if (control && control !== surface) place(control, e, false);
  }
  function queue(e: PointerEvent) {
    if (!pending) requestAnimationFrame(light);
    pending = e;
  }
  doc.addEventListener(
    'pointermove',
    function (e) {
      if (e.pointerType !== 'touch') queue(e);
    },
    { passive: true },
  );
  // Touch has no hover: light the spot the finger pressed.
  doc.addEventListener('pointerdown', queue, { passive: true });
  doc.addEventListener(
    'pointerout',
    function (e) {
      if (!(e.target instanceof Element)) return;
      var card = e.target.closest('.product');
      if (card && !card.contains(e.relatedTarget as Node | null)) {
        (card as HTMLElement).style.setProperty('--tx', '0');
        (card as HTMLElement).style.setProperty('--ty', '0');
      }
    },
    { passive: true },
  );

  /* ---- scroll state ------------------------------------------------------ */
  var lastY = win.scrollY;
  var scrollQueued = false;
  function scrolled() {
    scrollQueued = false;
    var y = win.scrollY;
    if (y > 8) root.setAttribute('data-scrolled', '');
    else root.removeAttribute('data-scrolled');
    if (Math.abs(y - lastY) > 10) {
      if (y > lastY && y > 120) root.setAttribute('data-scroll', 'down');
      else root.removeAttribute('data-scroll');
      lastY = y;
    }
  }
  win.addEventListener(
    'scroll',
    function () {
      if (!scrollQueued) requestAnimationFrame(scrolled);
      scrollQueued = true;
    },
    { passive: true },
  );
  scrolled();

  /* ---- background ------------------------------------------------------- */
  var canvas = doc.getElementById('lg-bg') as HTMLCanvasElement | null;
  if (!canvas) return;
  var gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  }) as WebGLRenderingContext | null;
  if (!gl) return;

  // Base, five lights, then how strongly each light shows (sRGB 0..1).
  var LIGHT = [
    0.925, 0.949, 0.965, 0.494, 0.808, 0.98, 0.467, 0.918, 0.82, 0.765, 0.69,
    1.0, 1.0, 0.776, 0.6, 0.973, 0.659, 0.835, 0.92, 0.86, 0.8, 0.62, 0.72, 0.0,
  ];
  var DARK = [
    0.02, 0.031, 0.067, 0.047, 0.478, 0.455, 0.122, 0.29, 0.86, 0.455, 0.188,
    0.878, 0.745, 0.094, 0.384, 0.031, 0.471, 0.62, 0.9, 0.72, 0.82, 0.42, 0.7,
    1.0,
  ];

  var vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  var fs = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'uniform vec2 uRes;uniform float uT;uniform vec3 uP;uniform float uS;',
    'uniform vec3 uBase,uA,uB,uC,uD,uE;uniform vec4 uK;uniform vec2 uK2;',
    'float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}',
    'float n(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);',
    'return mix(mix(h(i),h(i+vec2(1.,0.)),u.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),u.x),u.y);}',
    'float fbm(vec2 p){float v=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);',
    'for(int i=0;i<4;i++){v+=a*n(p);p=m*p;a*=.5;}return v;}',
    'float lamp(vec2 d,float r){return exp(-dot(d,d)/(r*r));}',
    'uniform vec4 uL[8];uniform vec4 uLp[8];uniform float uLn;uniform vec3 uLi;',
    'vec3 bg(vec2 fc){',
    'vec2 uv=fc/uRes;float asp=uRes.x/uRes.y;float t=uT;',
    'vec2 p=vec2(uv.x*asp,uv.y);vec2 f=p+vec2(0.,uS);',
    // Two-step warp: the noise moves the coordinates the lights are read at.
    'vec2 q=vec2(fbm(f*1.25+vec2(0.,t*.045)),fbm(f*1.25+vec2(5.2,1.3-t*.04)));',
    'vec2 r=vec2(fbm(f*1.1+2.1*q+vec2(1.7,9.2)+t*.028),fbm(f*1.1+2.1*q+vec2(8.3,2.8)-t*.032));',
    'vec2 w=p+.46*(r-.5);',
    'vec2 pp=vec2(uP.x*asp,uP.y);float pl=lamp(p-pp,.42)*uP.z;w+=(pp-p)*pl*.1;',
    'vec2 c1=vec2(asp*(.16+.1*sin(t*.11)),.8+.08*cos(t*.13));',
    'vec2 c2=vec2(asp*(.84+.08*cos(t*.09)),.86+.07*sin(t*.12));',
    'vec2 c3=vec2(asp*(.64+.12*sin(t*.07+1.)),.28+.1*cos(t*.1));',
    'vec2 c4=vec2(asp*(.18+.09*cos(t*.08+2.)),.16+.08*sin(t*.09));',
    'vec2 c5=vec2(asp*(.46+.14*sin(t*.05+4.)),.56+.12*cos(t*.06));',
    'vec3 c=uBase;',
    'c=mix(c,uA,lamp(w-c1,.62)*uK.x);c=mix(c,uB,lamp(w-c2,.56)*uK.y);',
    'c=mix(c,uC,lamp(w-c3,.6)*uK.z);c=mix(c,uD,lamp(w-c4,.5)*uK.w);',
    'c=mix(c,uE,lamp(w-c5,.44)*uK2.x);',
    // A faint sheen along the warped ridges reads as moving liquid.
    'float ridge=smoothstep(.52,.86,fbm(w*2.3+t*.02));c+=mix(.04,.03,uK2.y)*ridge;',
    // Fine threads of light along the flow (contours of the warp): they give
    // the glass something to bend.
    'float v=fbm(w*1.7+vec2(t*.018,-t*.012));',
    'float th=(1.-smoothstep(0.,.03,abs(v-.5)))+.6*(1.-smoothstep(0.,.022,abs(v-.62)));',
    'c+=th*mix(vec3(.07),vec3(.05,.07,.09),uK2.y)*(.55+.45*sin(t*.2+w.x*3.));',
    'c=mix(c,mix(mix(c,vec3(1.),.5),c*1.45+vec3(.015,.04,.06),uK2.y),pl*.5);',
    'c*=mix(1.,1.-.28*length(uv-vec2(.5,.62)),uK2.y);',
    'return c;}',
    'float rr(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+vec2(r);return min(max(q.x,q.y),0.)+length(max(q,0.))-r;}',
    'void main(){',
    'vec2 fc=gl_FragCoord.xy;vec3 c=bg(fc);',
    'for(int i=0;i<8;i++){if(float(i)>=uLn)break;',
    'vec4 R=uL[i];vec4 P=uLp[i];vec2 hb=R.zw*.5;vec2 q=fc-R.xy-hb;float d=rr(q,hb,P.x);',
    'if(d<1.){',
    // Outward normal from the distance field; k is 1 at the edge, 0 inside.
    'vec2 e=vec2(1.,0.);vec2 nr=normalize(vec2(rr(q+e,hb,P.x)-rr(q-e,hb,P.x),rr(q+e.yx,hb,P.x)-rr(q-e.yx,hb,P.x))+1e-4);',
    'float k=1.-clamp(-d/P.y,0.,1.);float bend=k*k*P.y*P.z;',
    // Edge: read from further out (the bevel bends light inward). Inside: a
    // slight magnification around the center, as through a thick pane.
    'vec2 o=nr*bend-q*.045;',
    'vec3 g=vec3(bg(fc+o*1.1).r,bg(fc+o).g,bg(fc+o*.9).b);',
    'g=g*mix(1.05,1.12,uK2.y)+mix(.035,.015,uK2.y);',
    'vec2 L=uLi.z>.5?normalize(uLi.xy-(R.xy+hb)+1e-4):normalize(vec2(-.55,.84));',
    'float f=max(dot(nr,L),0.);float b2=max(dot(nr,-L),0.);',
    'float rim=smoothstep(.55,1.,k);',
    'g+=vec3(1.)*(pow(f,5.)*rim*mix(.62,.45,uK2.y)+pow(f,2.)*k*k*mix(.12,.08,uK2.y)+pow(b2,5.)*rim*mix(.22,.16,uK2.y));',
    'c=mix(c,g,smoothstep(1.,-1.,d));}}',
    'c+=(h(fc+fract(uT*7.))-.5)/160.;',
    'gl_FragColor=vec4(c,1.);}',
  ].join('\n');

  function shader(type: number, src: string) {
    var s = gl!.createShader(type)!;
    gl!.shaderSource(s, src);
    gl!.compileShader(s);
    return gl!.getShaderParameter(s, gl!.COMPILE_STATUS) ? s : null;
  }
  var v = shader(gl.VERTEX_SHADER, vs);
  var f = shader(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return;
  var prog = gl.createProgram()!;
  gl.attachShader(prog, v);
  gl.attachShader(prog, f);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  var loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  function u(name: string) {
    return gl!.getUniformLocation(prog, name);
  }
  var U = {
    res: u('uRes'),
    t: u('uT'),
    p: u('uP'),
    s: u('uS'),
    base: u('uBase'),
    a: u('uA'),
    b: u('uB'),
    c: u('uC'),
    d: u('uD'),
    e: u('uE'),
    k: u('uK'),
    k2: u('uK2'),
    lens: u('uL[0]'),
    lensP: u('uLp[0]'),
    lensN: u('uLn'),
    light: u('uLi'),
  };

  function isDark() {
    var t = root.getAttribute('data-theme');
    return t === 'dark' || (t !== 'light' && darkMq.matches);
  }
  var palette = (isDark() ? DARK : LIGHT).slice();
  var target = palette;
  function setPalette() {
    var pl = palette;
    gl!.uniform3f(U.base, pl[0], pl[1], pl[2]);
    gl!.uniform3f(U.a, pl[3], pl[4], pl[5]);
    gl!.uniform3f(U.b, pl[6], pl[7], pl[8]);
    gl!.uniform3f(U.c, pl[9], pl[10], pl[11]);
    gl!.uniform3f(U.d, pl[12], pl[13], pl[14]);
    gl!.uniform3f(U.e, pl[15], pl[16], pl[17]);
    gl!.uniform4f(U.k, pl[18], pl[19], pl[20], pl[21]);
    gl!.uniform2f(U.k2, pl[22], pl[23]);
  }

  // Pointer light, eased so it trails the cursor like light through water.
  var px = 0.5;
  var py = 0.6;
  var pz = 0;
  var tx = px;
  var ty = py;
  var tz = 0;
  if (!coarse) {
    win.addEventListener(
      'pointermove',
      function (e) {
        if (e.pointerType !== 'mouse') return;
        tx = e.clientX / win.innerWidth;
        ty = 1 - e.clientY / win.innerHeight;
        tz = 1;
      },
      { passive: true },
    );
    doc.addEventListener('mouseout', function (e) {
      if (!e.relatedTarget) tz = 0;
    });
  }

  var scale = coarse ? 0.4 : 0.5;
  // Lenses only where the panel floats over the background itself (wide
  // screens); on phones the bars sit over content, which WebGL cannot see.
  var wideMq = win.matchMedia('(min-width: 861px)');
  var rects = new Float32Array(32);
  var shapes = new Float32Array(32);
  var radius = new WeakMap<Element, number>();
  var lensOn = false;
  function lenses() {
    var n = 0;
    if (wideMq.matches) {
      var els = doc.querySelectorAll('[data-lens]');
      var sx = canvas!.width / Math.max(1, canvas!.clientWidth);
      var sy = canvas!.height / Math.max(1, canvas!.clientHeight);
      var vh = canvas!.clientHeight;
      for (var i = 0; i < els.length && n < 8; i++) {
        var el = els[i];
        var r = el.getBoundingClientRect();
        if (r.width < 4 || r.bottom < 0 || r.top > vh) continue;
        var rad = radius.get(el);
        if (rad === undefined) {
          rad = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
          radius.set(el, rad);
        }
        rects[n * 4] = r.left * sx;
        rects[n * 4 + 1] = (vh - r.bottom) * sy;
        rects[n * 4 + 2] = r.width * sx;
        rects[n * 4 + 3] = r.height * sy;
        shapes[n * 4] = Math.min(rad, r.width / 2, r.height / 2) * sx;
        shapes[n * 4 + 1] = Math.max(8, Math.min(rad * 1.1, 30)) * sx;
        shapes[n * 4 + 2] = 1.5;
        n++;
      }
    }
    gl!.uniform4fv(U.lens, rects);
    gl!.uniform4fv(U.lensP, shapes);
    gl!.uniform1f(U.lensN, n);
    if (!!n !== lensOn) {
      lensOn = !!n;
      root.classList.toggle('lg-lens', lensOn);
    }
  }
  function size() {
    var w = Math.max(1, Math.round(canvas!.clientWidth * scale));
    var hgt = Math.max(1, Math.round(canvas!.clientHeight * scale));
    if (canvas!.width !== w || canvas!.height !== hgt) {
      canvas!.width = w;
      canvas!.height = hgt;
      gl!.viewport(0, 0, w, hgt);
      gl!.uniform2f(U.res, w, hgt);
    }
  }
  function draw() {
    size();
    gl!.uniform1f(U.t, (Date.now() / 1000) % 3000);
    gl!.uniform3f(U.p, px, py, pz);
    gl!.uniform1f(U.s, (win.scrollY / Math.max(1, win.innerHeight)) * 0.12);
    gl!.uniform3f(
      U.light,
      px * canvas!.width,
      py * canvas!.height,
      pz > 0.5 ? 1 : 0,
    );
    lenses();
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
  }
  function retheme() {
    target = isDark() ? DARK : LIGHT;
    // Snap during a view transition (the reveal shows the final colors) and
    // when nothing animates; otherwise the loop eases into the new palette.
    if (reduceMq.matches || root.hasAttribute('data-vt')) {
      palette = target.slice();
      setPalette();
      draw();
    }
  }

  setPalette();
  draw();
  root.classList.add('lg-gl');

  new MutationObserver(retheme).observe(root, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-vt'],
  });
  darkMq.addEventListener('change', retheme);
  // Without the loop (reduced motion), redraw when the lenses move.
  var still = false;
  function stillDraw() {
    if (!reduceMq.matches || still) return;
    still = true;
    requestAnimationFrame(function () {
      still = false;
      draw();
    });
  }
  win.addEventListener('resize', stillDraw);
  win.addEventListener('scroll', stillDraw, { passive: true });
  // The page's panels exist once it is parsed: draw them into the first
  // frame the browser shows (and the view-transition snapshot).
  doc.addEventListener('DOMContentLoaded', draw);
  win.addEventListener('pagereveal', draw);

  var raf = 0;
  var last = 0;
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    if (now - last < 33) return;
    last = now;
    px += (tx - px) * 0.08;
    py += (ty - py) * 0.08;
    pz += (tz - pz) * 0.06;
    if (target !== palette) {
      var done = true;
      for (var i = 0; i < palette.length; i++) {
        palette[i] += (target[i] - palette[i]) * 0.16;
        if (Math.abs(target[i] - palette[i]) > 0.002) done = false;
      }
      if (done) palette = target.slice();
      setPalette();
      if (done) target = palette;
    }
    draw();
  }
  function run() {
    cancelAnimationFrame(raf);
    if (!reduceMq.matches && !doc.hidden) raf = requestAnimationFrame(frame);
    else draw();
  }
  doc.addEventListener('visibilitychange', run);
  reduceMq.addEventListener('change', run);
  canvas.addEventListener('webglcontextlost', function (e) {
    e.preventDefault();
    cancelAnimationFrame(raf);
    root.classList.remove('lg-gl');
  });
  run();
}

export const liquidScript = `(${liquid.toString()})()`;
