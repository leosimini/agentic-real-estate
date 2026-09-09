# Umbral design system

## Product register

Umbral is a task-focused product interface. The visual system should help people describe a real-estate need, understand why a property was selected, and verify the evidence behind it.

## Experience principles

- Photo-first discovery: property imagery establishes context before facts and actions.
- Intent before filters: natural-language search stays primary; structured criteria remain an editable confirmation step.
- Calm confidence: restrained color, clean surfaces, strong hierarchy, and limited elevation.
- Honest provenance: generated editorial imagery is always labeled `Imagen de referencia`. Source media must remain attributable to its publication.
- One property, many sources: cards represent canonical properties and expose publication count and freshness.
- Accessible by default: WCAG 2.2 AA, complete keyboard operation, visible focus, 44 px minimum controls, and no horizontal overflow at 360 px.

## Color

Colors are defined as OKLCH tokens in `apps/web/src/app/globals.css`.

- Canvas: lightly green-tinted neutral.
- Surface: near-white tinted neutral, never pure white.
- Ink: deep mineral charcoal.
- Accent: mineral green for primary actions, selection, and verified state.
- Warm: terracotta for attention and saved state.
- Focus: blue with strong contrast across light and dark surfaces.

The palette is restrained. Accent color should normally occupy less than ten percent of the viewport, except for the intent composer and mobile navigation where it communicates a focused product state.

## Typography

- Family: Inter when available, followed by the platform UI sans stack.
- Display: 750 to 780 weight, tight negative tracking.
- Body: 400 to 560 weight, 1.5 to 1.65 line height.
- Labels: 650 to 820 weight. Uppercase is reserved for short eyebrow labels and status badges.
- Product headings use fixed responsive breakpoints rather than fluid type.

## Shape and elevation

- Controls: 10 to 12 px radius.
- Property cards: 19 to 22 px radius.
- Large media and panels: 20 to 26 px radius.
- Pills: status and compact metadata only.
- Shadows: three levels. Use small for floating labels, medium for hovered cards, large for modal panels.
- Avoid nested card treatments. Separate internal sections with spacing, background tint, or a single border.

## Photography

- Listing card ratio: 16:10 desktop and 4:3 mobile.
- Detail ratio: 16:10 desktop and 4:3 mobile.
- Use `object-fit: cover` and preserve a stable intrinsic ratio through `next/image`.
- Editorial reference images must carry a visible label. They do not prove a property's condition or amenities.
- Verified source photography should eventually replace reference imagery through the source adapter and media pipeline.

## Motion

- Standard transitions: 160 to 240 ms using an ease-out curve.
- Card hover: translate up to 4 px and strengthen elevation.
- Image hover: scale up to 1.035.
- Dialog entrance: opacity plus translate only.
- Respect `prefers-reduced-motion` and reduce all nonessential animation to effectively zero.

## Responsive behavior

- Desktop: fixed 232 px navigation rail, two-column property grid.
- Tablet: reduced hero ratio and two-column criteria form.
- Mobile: single-column photo cards, full-width search composer, fixed five-item bottom navigation.
- Primary breakpoint: 800 px. Compact breakpoint: 560 px.
- Required minimum verification width: 360 px.

## Component states

Buttons, navigation, cards, inputs, save controls, alerts, dialogs, and source links must support default, hover, focus, active or selected, disabled or loading, and error states where applicable.
