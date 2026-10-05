// The site's script for its pages in the Visual editor only: loaded in render sessions, never on the live site
// (docs/compatibility.md). The Compat spec checks it runs, and hears each live re-render.
document.addEventListener('visual-editor:before-render', (e) => {
    console.log("Pre-render", e);
});
document.addEventListener('visual-editor:rendered', (e) => {
    console.log("Rendered", e);
});
