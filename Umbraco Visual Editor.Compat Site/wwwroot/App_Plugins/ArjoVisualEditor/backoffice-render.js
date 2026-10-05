// The site's script for its pages in the Visual editor only: loaded in render sessions, never on the live site
// (docs/compatibility.md). The Compat spec checks it runs, and hears each live re-render.
window.compatRenderScript = { loaded: true, renders: 0 };
document.addEventListener('visual-editor:rendered', () => {
    window.compatRenderScript.renders++;
});
