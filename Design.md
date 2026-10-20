# MantraAI Browser Design System

This file is the design reference for all MantraAI Browser interface work. Before changing browser chrome, the new-tab page, the sidebar, Settings, dialogs, or other app-owned UI, read this document and follow the shared theme. If a future request explicitly changes the visual direction, update this file to match the approved direction.

## Midnight Saffron

Use the Midnight Saffron palette shown in the project reference image:

| Token | Color | Use |
| --- | --- | --- |
| Background | `#080F1B` | Main browser and app-owned page background |
| Panels | `#111C2B` | Cards, menus, inputs, and panel surfaces |
| Saffron gold | `#F3BD59` | Primary accent, selected states, key actions, and focus rings |
| Text | `#F5F0E6` | Main text on the dark theme |

Supporting colors should stay within the same restrained navy, slate, and warm-gold family. Use muted cool gray for secondary text and subdued blue-gray for borders. Keep contrast sufficient for readable text and controls. Prefer the existing CSS custom properties in `style.css` over adding new hard-coded palette values.

The dark Midnight Saffron theme is the default and the reference for new interface work. Keep the existing optional Light setting functional; its explicit user-selected overrides do not change the default theme or this reference.

## Brand and assets

- Preserve the existing MantraAI logo files and their current uses. Do not replace, redraw, recolor, crop, or remove the logo as part of unrelated UI work.
- Keep the established MantraAI Browser wordmark, gold accents, and browser identity intact.
- Do not apply browser-shell styles to remote websites shown in `WebContentsView`; websites keep their own appearance.

## Interface style

- Use the existing Segoe UI font stack (`Segoe UI`, then `Arial`, then system sans-serif).
- Keep layouts compact and clear, with rounded surfaces, thin blue-gray borders, and consistent spacing. Reuse existing component styles and CSS variables where possible.
- Use saffron for emphasis and primary actions; avoid introducing unrelated bright accent colors or excessive glow.
- Keep hover feedback subtle. Preserve visible keyboard focus using the gold focus outline and maintain accessible labels for icon-only controls.
- Respect the existing responsive breakpoints and the browser toolbar, tabs, address bar, and single right-side panel layout.
- Keep transitions short and functional; avoid animations that delay navigation or controls.

## Scope and implementation guidance

- This theme applies to MantraAI-owned surfaces: browser chrome, the home page, sidebar, settings, dialogs, and browser-generated views.
- Do not restyle arbitrary page content or inject theme CSS into remote websites.
- Preserve Electron, `WebContentsView`, IPC boundaries, tab behavior, and working browser features when making visual changes. Make the smallest targeted change that fulfills the request.
- For future design or modification tasks, use this file as the common visual reference. Update it only when the user requests an approved theme change.
