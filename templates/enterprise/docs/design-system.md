# Design System

UI guidance for agents. Reuse what exists before building anything new.

## Components

- Library + version: `[TODO(tison): the component library in use, with version]`
- Shared components live in: `[TODO(tison): the path shared components live under]`
- Check there before creating a new component.

## Tokens

- Use design tokens for colour, spacing, and type. Never hardcode values.
- Defined in: `[TODO(tison): the path design tokens are defined in]`
- Use semantic colour pairs (background + foreground) so contrast holds by construction.

## Accessibility (WCAG 2.2 AA)

- Use semantic HTML first (`<button>`, `<a>`, `<label>`). Don't bolt `role` onto a `<div>` when a native element exists.
- Every interactive element must be keyboard-reachable with a visible focus state.
- Touch targets at least 24x24px; 44px preferred.
- Images need alt text; inputs need associated labels.

## Do / Don't

<!-- A short code example beats a sentence here. Both slots want real snippets,
     so they're yours to write. -->

- Do: [TODO(tison:human): one correct usage example for a common pattern.]
- Don't: [TODO(tison:human): the matching wrong way.]

---

Accessible components don't make an accessible page — heading order, landmarks,
and focus flow still need checking in context. Automated checks catch roughly
half of issues; the rest need a human pass.
