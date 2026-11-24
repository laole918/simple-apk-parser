# Browser Demo

[`demo/index.html`](../../../demo/index.html) owns the markup and styles. [`demo/main.js`](../../../demo/main.js) imports the browser entry from `src/` and attaches DOM listeners directly. Serve the demo from the repository root, as shown in the [README](../../../README.md). Keep element IDs and the corresponding lookups synchronized when changing the demo.

`setActiveTab` toggles `is-active` on tabs and panels and updates `aria-selected`. The markup supplies tab roles and an accessible tablist label. Preserve this existing state synchronization when modifying the input modes.

```js
fileTab.classList.toggle("is-active", isFile);
fileTab.setAttribute("aria-selected", String(isFile));
```

The demo reads `loadResources` from the checkbox and passes it to either parse method. Each parse handler calls `resetPreview` before awaiting the parser. `resetPreview` revokes the current icon object URL and clears the preview. `renderResult` creates a new URL when the result includes an icon Blob. Use `textContent` to display result text and errors, and revoke the current URL when clearing the preview.
