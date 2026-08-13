// On-demand loader for the search modal.
//
// SearchModal (React + the full search index JSON) used to hydrate as an
// island on every page (~175 KB of JS on first load). Instead, this tiny
// module listens for the search triggers and dynamically imports + mounts
// the modal the first time one fires. Subsequent opens are handled by the
// modal's own listeners; ours stay idempotent (classList.add + focus).
//
// Listeners are delegated on `document` so they survive Astro view
// transitions; the mounted container lives on <body>, which the ClientRouter
// replaces on navigation — so we remount whenever it is no longer connected.

let container: HTMLElement | null = null;

async function openSearch() {
  if (!container || !container.isConnected) {
    const [{ createElement }, { createRoot }, { default: SearchModal }] =
      await Promise.all([
        import("react"),
        import("react-dom/client"),
        import("./SearchModal"),
      ]);
    container = document.createElement("div");
    document.body.appendChild(container);
    createRoot(container).render(createElement(SearchModal));
  }
  // Wait for the modal's effect to run (it binds its own listeners), then open.
  requestAnimationFrame(() => {
    document.getElementById("searchModal")?.classList.add("show");
    document.getElementById("searchInput")?.focus();
  });
}

document.addEventListener("click", (event) => {
  const trigger = (event.target as HTMLElement | null)?.closest(
    "[data-search-trigger]",
  );
  if (trigger) openSearch();
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "k") {
    event.preventDefault();
    openSearch();
  }
});
