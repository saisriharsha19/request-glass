// Event-driven gaze: no global mouse handler, idle loop, or page transforms.
const motion = matchMedia('(prefers-reduced-motion: reduce)');
for (const character of document.querySelectorAll('.desk-character')) {
  const eyes = character.querySelector('.folder-eyes');
  const pupils = character.querySelector('.folder-pupils');
  let frame = 0, rect, point, blink;
  function reset() {
    cancelAnimationFrame(frame);
    frame = 0;
    pupils.style.transform = '';
  }
  function look() {
    frame = 0;
    if (!rect || motion.matches) return;
    const dx = (point.x - rect.left) / rect.width * 100 - 58;
    const dy = (point.y - rect.top) / rect.height * 100 - 45;
    const distance = Math.hypot(dx, dy) || 1;
    const reach = Math.min(distance / 25, 1);
    pupils.style.transform = `translate(${dx / distance * .9 * reach}px, ${dy / distance * .85 * reach}px)`;
  }
  character.addEventListener('pointerenter', () => { rect = character.getBoundingClientRect(); });
  character.addEventListener('pointermove', event => {
    if (motion.matches || event.pointerType === 'touch') return;
    point = { x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(look);
  });
  character.addEventListener('pointerleave', reset);
  character.addEventListener('pointercancel', reset);
  character.addEventListener('blur', reset);
  character.addEventListener('click', () => {
    if (motion.matches) return;
    blink?.cancel();
    blink = eyes.animate([
      { transform: 'scaleY(1)' }, { transform: 'scaleY(.08)', offset: .22 },
      { transform: 'scaleY(1)', offset: .42 }, { transform: 'scaleY(1)', offset: .65 },
      { transform: 'scaleY(.08)', offset: .8 }, { transform: 'scaleY(1)' },
    ], { duration: 650, easing: 'ease-in-out' });
  });
  motion.addEventListener('change', () => { reset(); blink?.cancel(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { reset(); blink?.cancel(); } });
}
