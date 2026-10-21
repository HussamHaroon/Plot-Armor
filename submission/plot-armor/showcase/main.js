/* Team Plot Armor showcase — "The Relay"
 * The only place GSAP 3.13 + Lenis are allowed (CDN, defer).
 * Everything is gated on the .has-motion class set by the inline head script
 * (fine pointer + no reduced-motion). No class, no library, static page —
 * and if the CDN ever fails, we drop back to that same static page. */
(function () {
  'use strict';

  var root = document.documentElement;
  if (!root.classList.contains('has-motion')) return;

  var booted = false;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  function boot() {
    if (booted) return;
    booted = true;
    if (!window.gsap || !window.ScrollTrigger) {
      /* CDN unavailable — bail to the clean static version */
      root.classList.remove('has-motion');
      return;
    }
    gsap.registerPlugin(ScrollTrigger);

    /* Lenis smooth scroll, driven by the gsap ticker (patterns.md assembly) */
    var lenis = null;
    if (window.Lenis) {
      lenis = new Lenis({
        duration: 1.1,
        easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      });
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add(t => lenis.raf(t * 1000));
      gsap.ticker.lagSmoothing(0);
    }

    /* chapter anchors ride lenis so the sticky nav never clips the target */
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', e => {
        const id = a.getAttribute('href');
        const target = id.length > 1 ? document.querySelector(id) : null;
        if (!target) return;
        e.preventDefault();
        if (lenis) lenis.scrollTo(target, { offset: -72 });
        else target.scrollIntoView({ behavior: 'smooth' });
      });
    });

    setupPreloader();
    setupMarquee();
    setupRouteSpine();
    setupChapters();
    setupCursor();
    setupMagnetic();
  }

  /* ---- 1. Preloader ritual: counter 000→100 + route line draw, ≤2.2s ---- */
  function setupPreloader() {
    const pre = document.querySelector('.preloader');
    const count = document.querySelector('.pre-count');
    const draw = document.querySelector('.pre-route-draw');
    const dot = document.querySelector('.pre-route-dot');

    const heroLine = gsap.utils.toArray('[data-hero="line"]');
    const heroRest = gsap.utils.toArray('[data-hero]:not([data-hero="line"])');
    const revealHero = () => {
      gsap.timeline()
        .to(heroRest[0] || [], { opacity: 1, y: 0, duration: 1.1, ease: 'expo.out' })
        .to(heroLine, { opacity: 1, y: 0, duration: 1.2, ease: 'expo.out', stagger: 0.1 }, '-=0.75')
        .to(heroRest.slice(1), { opacity: 1, y: 0, duration: 1.1, ease: 'expo.out', stagger: 0.12 }, '-=0.85');
      /* the warehouse→camp motif draws itself as the hero lands */
      const hr = document.querySelector('.hr-draw');
      if (hr) {
        const L = hr.getTotalLength();
        gsap.fromTo(hr, { strokeDasharray: L, strokeDashoffset: L },
          { strokeDashoffset: 0, duration: 1.7, ease: 'power2.inOut', delay: 0.25 });
        gsap.fromTo('.hr-dot', { scale: 0, transformOrigin: 'center' },
          { scale: 1, duration: 0.6, ease: 'expo.out', stagger: 0.45, delay: 0.25 });
      }
    };

    if (!pre || !count) return revealHero();
    const len = draw ? draw.getTotalLength() : 320;
    if (draw) {
      gsap.set(draw, { strokeDasharray: len, strokeDashoffset: len });
      if (dot) dot.setAttribute('cx', '0');
    }
    const state = { v: 0 };
    gsap.timeline()
      .to(state, {
        v: 100, duration: 1.4, ease: 'power2.inOut',
        onUpdate: () => {
          const n = Math.round(state.v);
          count.textContent = String(n).padStart(3, '0');
          if (draw) gsap.set(draw, { strokeDashoffset: len * (1 - n / 100) });
          if (dot) dot.setAttribute('cx', String(320 * n / 100));
        },
      })
      .to(pre, {
        clipPath: 'inset(0 0 100% 0)', duration: 0.7, ease: 'expo.inOut',
        onStart: revealHero, /* hero stages in as the wipe lifts */
        onComplete: () => { pre.style.visibility = 'hidden'; },
      }, '+=0.1');
  }

  /* ---- 2. The one marquee rail (paused on hover) ---- */
  function setupMarquee() {
    const track = document.getElementById('mq-track');
    if (!track) return;
    const tw = gsap.to(track, { xPercent: -50, ease: 'none', duration: 26, repeat: -1 });
    track.addEventListener('mouseenter', () => tw.pause());
    track.addEventListener('mouseleave', () => tw.play());
  }

  /* ---- 3. Route spine: one line scrubbing down through chapters 01→02→03 ---- */
  function setupRouteSpine() {
    const wrap = document.getElementById('chapters');
    const svg = wrap ? wrap.querySelector('.route-svg') : null;
    const base = document.getElementById('route-base');
    const draw = document.getElementById('route-draw');
    const dotsG = document.getElementById('route-dots');
    if (!wrap || !svg || !base || !draw || !dotsG) return;

    const chapters = gsap.utils.toArray('.chapter', wrap);
    const NS = 'http://www.w3.org/2000/svg';
    let triggers = [];

    function build() {
      triggers.forEach(t => {
        if (t.scrollTrigger) t.scrollTrigger.kill();
        if (t.kill) t.kill();
      });
      triggers = [];
      dotsG.innerHTML = '';

      const W = 60;
      const H = wrap.offsetHeight;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      const wrect = wrap.getBoundingClientRect();
      const pts = chapters.map(ch => {
        const r = ch.getBoundingClientRect();
        return { x: W / 2, y: r.top - wrect.top + Math.min(r.height * 0.3, 240) };
      });

      let d = 'M ' + W / 2 + ' 0';
      pts.forEach((p, i) => {
        const prevY = i === 0 ? 0 : pts[i - 1].y;
        const seg = p.y - prevY;
        const c1 = W / 2 + (i % 2 ? 20 : -20);
        const c2 = W / 2 + (i % 2 ? -20 : 20);
        d += ' C ' + c1 + ' ' + (prevY + seg * 0.4) + ', ' + c2 + ' ' + (prevY + seg * 0.6) + ', ' + W / 2 + ' ' + p.y;
      });
      d += ' L ' + W / 2 + ' ' + H;
      base.setAttribute('d', d);
      draw.setAttribute('d', d);

      const L = draw.getTotalLength();
      gsap.set(draw, { strokeDasharray: L, strokeDashoffset: L });
      triggers.push(gsap.to(draw, {
        strokeDashoffset: 0, ease: 'none',
        scrollTrigger: { trigger: wrap, start: 'top 65%', end: 'bottom 90%', scrub: 0.6 },
      }));

      pts.forEach((p, i) => {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', String(p.x));
        c.setAttribute('cy', String(p.y));
        c.setAttribute('r', '7');
        c.setAttribute('class', 'route-dot');
        dotsG.appendChild(c);
        triggers.push(ScrollTrigger.create({
          trigger: chapters[i], start: 'top 72%', once: true,
          onEnter: () => gsap.to(c, { scale: 1, duration: 0.7, ease: 'expo.out' }),
        }));
      });
    }

    build();
    let rT;
    window.addEventListener('resize', () => {
      clearTimeout(rT);
      rT = setTimeout(build, 200);
    });
  }

  /* ---- 4. Chapter reveals: staged text, clip-path wipes, count-ups, parallax ---- */
  function setupChapters() {
    ScrollTrigger.batch('[data-reveal]', {
      start: 'top 86%', once: true,
      onEnter: batch => gsap.to(batch, {
        opacity: 1, y: 0, duration: 1.2, ease: 'expo.out', stagger: 0.09, overwrite: 'auto',
      }),
    });
    ScrollTrigger.batch('[data-wipe]', {
      start: 'top 82%', once: true,
      onEnter: batch => gsap.to(batch, {
        clipPath: 'inset(0 0 0% 0)', duration: 1.2, ease: 'expo.out', stagger: 0.12, overwrite: 'auto',
      }),
    });

    gsap.utils.toArray('[data-count]').forEach(el => {
      const target = parseFloat(el.dataset.count);
      const dec = parseInt(el.dataset.decimals || '0', 10);
      const obj = { v: 0 };
      ScrollTrigger.create({
        trigger: el, start: 'top 85%', once: true,
        onEnter: () => gsap.to(obj, {
          v: target, duration: 1.4, ease: 'expo.out',
          onUpdate: () => { el.textContent = obj.v.toFixed(dec); },
        }),
      });
    });

    /* media drifts inside its card while the chapter passes (≤ 8% deltas) */
    gsap.utils.toArray('.media-card img').forEach(img => {
      gsap.fromTo(img, { yPercent: -3, scale: 1.08 }, {
        yPercent: 3, scale: 1.08, ease: 'none',
        scrollTrigger: {
          trigger: img.closest('.chapter'), start: 'top bottom', end: 'bottom top', scrub: true,
        },
      });
    });
  }

  /* ---- 5. Custom cursor — the dot grows a [ VIEW ] pill over viewables ---- */
  function setupCursor() {
    const cur = document.querySelector('.cursor');
    if (!cur) return;
    const xTo = gsap.quickTo(cur, 'x', { duration: 0.35, ease: 'expo.out' });
    const yTo = gsap.quickTo(cur, 'y', { duration: 0.35, ease: 'expo.out' });
    window.addEventListener('mousemove', e => { xTo(e.clientX); yTo(e.clientY); }, { passive: true });
    document.addEventListener('mouseover', e => {
      if (e.target.closest('[data-view]')) cur.classList.add('is-view');
    });
    document.addEventListener('mouseout', e => {
      if (e.target.closest('[data-view]')) cur.classList.remove('is-view');
    });
  }

  /* ---- 6. Magnetic CTAs — pull toward the cursor, spring back on leave ---- */
  function setupMagnetic() {
    document.querySelectorAll('[data-magnet]').forEach(btn => {
      const xTo = gsap.quickTo(btn, 'x', { duration: 0.4, ease: 'power3.out' });
      const yTo = gsap.quickTo(btn, 'y', { duration: 0.4, ease: 'power3.out' });
      btn.addEventListener('mousemove', e => {
        const r = btn.getBoundingClientRect();
        xTo((e.clientX - r.left - r.width / 2) * 0.3);
        yTo((e.clientY - r.top - r.height / 2) * 0.3);
      });
      btn.addEventListener('mouseleave', () => {
        gsap.to(btn, { x: 0, y: 0, duration: 0.7, ease: 'elastic.out(1, 0.4)', overwrite: 'auto' });
      });
    });
  }

})();
