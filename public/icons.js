// A small, consistent set drawn on a 24px grid for ReturnRadar.
const paths = {
  pocket:
    '<path d="m6 8 2-5 11 3-1 6M4 10V6h8l3 4M3 10h18l-2 11H5z"/><path d="m8 15 3 2 5-4"/>',
  folder:
    '<path d="M3 7h7l2-3h8a1 1 0 0 1 1 1v14H3z"/><path d="M3 9h18M7 14h6"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18M7 14h2m4 0h2m-8 4h2"/>',
  chart: '<path d="M4 3v17h17M8 16v-5m5 5V7m5 9V4"/>',
  archive: '<path d="M4 8v13h16V8M3 3h18v5H3zM9 12h6"/>',
  document: '<path d="M5 3h10l4 4v14H5zM15 3v5h4M8 12h8M8 16h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  mark: '<path d="M4 4h11l5 5v11H4zM14 4v6h6M8 15h8M8 11h3"/>',
};
export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.65",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
  }))
    svg.setAttribute(key, value);
  svg.classList.add("rr-icon");
  svg.innerHTML = paths[name] || paths.document;
  return svg;
}
for (const element of document.querySelectorAll("[data-icon]"))
  element.replaceChildren(icon(element.dataset.icon));
