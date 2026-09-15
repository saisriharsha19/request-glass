// Eight small paper cuts, art-directed around the action that just succeeded.
// No layout changes, loops, randomized confetti, blur or full-screen overlay.
const cuts = [
  { x: -48, y: -42, r: -28, w: 4, h: 9, color: "#ab563a", delay: 0 },
  { x: -23, y: -65, r: 22, w: 3, h: 7, color: "#536849", delay: 35 },
  { x: 8, y: -58, r: -16, w: 6, h: 3, color: "#b59a5d", delay: 10 },
  { x: 36, y: -49, r: 36, w: 3, h: 9, color: "#ab563a", delay: 55 },
  { x: 53, y: -23, r: -35, w: 5, h: 3, color: "#536849", delay: 15 },
  { x: -56, y: -16, r: 18, w: 5, h: 3, color: "#b59a5d", delay: 60 },
  { x: 24, y: -21, r: -42, w: 3, h: 6, color: "#b59a5d", delay: 40 },
  { x: -8, y: -32, r: 32, w: 3, h: 5, color: "#536849", delay: 20 },
];
export function celebrate(point) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden)
    return;
  document.querySelector(".paper-burst")?.remove();
  const x = Math.max(65, Math.min(innerWidth - 65, point?.x ?? innerWidth / 2));
  const y = Math.max(
    85,
    Math.min(innerHeight - 20, point?.y ?? innerHeight - 60),
  );
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "-70 -85 140 105");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("paper-burst");
  // Position is a transform on an isolated, pointer-transparent element.
  svg.style.left = `${x - 70}px`;
  svg.style.top = `${y - 85}px`;
  document.body.append(svg);
  for (const cut of cuts) {
    const rect = document.createElementNS(svg.namespaceURI, "rect");
    rect.setAttribute("x", String(-cut.w / 2));
    rect.setAttribute("y", String(-cut.h / 2));
    rect.setAttribute("width", String(cut.w));
    rect.setAttribute("height", String(cut.h));
    rect.setAttribute("rx", "0.5");
    rect.setAttribute("fill", cut.color);
    svg.append(rect);
    rect.animate(
      [
        { transform: "translate(0px, 0px) rotate(0deg)", opacity: 0 },
        {
          transform: `translate(${cut.x * 0.6}px, ${cut.y * 0.8}px) rotate(${cut.r * 0.6}deg)`,
          opacity: 1,
          offset: 0.32,
        },
        {
          transform: `translate(${cut.x}px, ${cut.y}px) rotate(${cut.r}deg)`,
          opacity: 1,
          offset: 0.68,
        },
        {
          transform: `translate(${cut.x + 3}px, ${cut.y + 10}px) rotate(${cut.r + 12}deg)`,
          opacity: 0,
        },
      ],
      {
        duration: 620,
        delay: cut.delay,
        easing: "cubic-bezier(.16,.65,.35,1)",
        fill: "both",
      },
    );
  }
  setTimeout(() => svg.remove(), 750);
}
