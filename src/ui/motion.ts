/**
 * The small motion layer, inlined at the top of <body> so it runs before the
 * first paint (and before React). Everything here is decoration: the page
 * works and reads the same without it, and none of it runs under reduced
 * motion.
 *
 * - Scroll state on <html>: data-scrolled once the page leaves the top (the
 *   header drops its hard shadow).
 * - Blocks below the first screen are held back (data-reveal) and tip into
 *   place when they scroll into view; blocks in the first screen arrive with
 *   the CSS cascade instead. This starts once React has hydrated.
 *
 * Self-contained on purpose: it is serialized with Function#toString.
 */
function motion() {
  var doc = document;
  var root = doc.documentElement;
  var win = window;
  var still = win.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- scroll state ------------------------------------------------------ */
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      if (win.scrollY > 4) root.setAttribute('data-scrolled', '');
      else root.removeAttribute('data-scrolled');
    });
  }
  win.addEventListener('scroll', onScroll, { passive: true });

  if (still) return;

  /* ---- reveal below the first screen ------------------------------------- */
  var REVEAL =
    '.stack > *, .mail-list > *, .products > *, .order-rows > *, .mq-cards > *, .after > *';
  function setup() {
    if (!('IntersectionObserver' in win)) return;
    var fold = win.innerHeight;
    var io = new IntersectionObserver(
      function (entries) {
        for (var k = 0; k < entries.length; k++) {
          var e = entries[k];
          if (!e.isIntersecting) continue;
          var el = e.target as HTMLElement;
          io.unobserve(el);
          el.removeAttribute('data-reveal');
          el.setAttribute('data-revealed', '');
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    var items = doc.querySelectorAll(REVEAL);
    var n = 0;
    for (var j = 0; j < items.length; j++) {
      var el = items[j] as HTMLElement;
      if (el.getBoundingClientRect().top < fold) continue;
      // Alternate the tilt so a column of cards does not lean one way.
      el.style.setProperty('--tilt', n++ % 2 ? '1.6deg' : '-1.6deg');
      el.setAttribute('data-reveal', '');
      io.observe(el);
    }
  }
  // After React has hydrated (the theme switch marks the page ready), so the
  // attributes added here never meet hydration.
  if (root.hasAttribute('data-ready')) setup();
  else {
    var mo = new MutationObserver(function () {
      if (!root.hasAttribute('data-ready')) return;
      mo.disconnect();
      setup();
    });
    mo.observe(root, { attributes: true, attributeFilter: ['data-ready'] });
  }
}

export const motionScript = `(${motion.toString()})();`;
