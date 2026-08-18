// Landing page scroll chrome: fade sections in, and draw the nav hairline
// only once the page has scrolled past the top.

function revealSectionsOnScroll() {
  const targets = document.querySelectorAll('[data-reveal]');
  if (!targets.length) return;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('shown');
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -10% 0px' });
  targets.forEach(target => observer.observe(target));
}

function markNavWhenStuck(nav) {
  const sentinel = document.createElement('div');
  // needs real height to intersect, and must stay out of the flow
  sentinel.style.cssText = 'position:absolute;top:0;width:1px;height:2px';
  nav.before(sentinel);
  new IntersectionObserver(([entry]) => {
    nav.toggleAttribute('data-stuck', !entry.isIntersecting);
  }).observe(sentinel);
}

revealSectionsOnScroll();
const nav = document.querySelector('.site-nav');
if (nav) markNavWhenStuck(nav);
