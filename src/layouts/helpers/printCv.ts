// Print/PDF support for the CV page.
//
// The "Download CV (PDF)" button simply triggers window.print() — the print
// stylesheet does the layout work, and the browser's "Save as PDF" produces
// a document that always carries the build-time computed numbers.
//
// beforeprint/afterprint (also fired for Ctrl/Cmd+P) handle two things CSS
// cannot: force every <details> accordion open so all jobs are printed, and
// temporarily strip the .dark class so the PDF is always light-on-white.

let openStates: boolean[] = [];
let wasDark = false;

function preparePrint() {
  const details = [...document.querySelectorAll<HTMLDetailsElement>("details")];
  openStates = details.map((d) => d.open);
  details.forEach((d) => (d.open = true));
  wasDark = document.documentElement.classList.contains("dark");
  if (wasDark) document.documentElement.classList.remove("dark");
}

function restoreAfterPrint() {
  const details = [...document.querySelectorAll<HTMLDetailsElement>("details")];
  details.forEach((d, i) => (d.open = openStates[i] ?? d.open));
  if (wasDark) document.documentElement.classList.add("dark");
}

window.addEventListener("beforeprint", preparePrint);
window.addEventListener("afterprint", restoreAfterPrint);

document.addEventListener("click", (event) => {
  const btn = (event.target as HTMLElement | null)?.closest("[data-print-cv]");
  if (btn) window.print();
});
