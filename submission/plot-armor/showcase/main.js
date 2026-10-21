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

})();
