# Gather — White Glass system

This is the active visual direction and supersedes the earlier visual-correction and Digital Social Atelier boards. Gather is a bright, premium social space with translucent floating tools over a pale blue-lavender canvas. It uses original Gather navigation and content patterns; it does not copy Apple, Instagram, or another product.

## Material board

- **Canvas:** cool near-white `#F7F9FC`, with sparse lavender and powder-blue ambient light behind floating layers. The gradient should be visible around panels without coloring the whole page.
- **Glass:** white with visible translucency, 20 px blur and moderate saturation; a fine white edge, soft blue-gray shadow and restrained inset highlight. Use a stronger glass variant for readable overlays and a lighter variant for secondary panes. Provide a solid background fallback when backdrop filters are unavailable.
- **Content:** white/solid media stage, posts, photos and text remain crisp. Use open content groups, dividers and occasional raised surfaces instead of wrapping every item in a glass card.
- **Identity:** lavender primary accent `#8B83E8`, soft violet surface `#EFEDFF`, powder-blue `#A9CCF5`, charcoal text, and restrained warm coral for secondary emphasis. Green is not the brand color.
- **Type/layout:** existing Inter/system stack; expressive title scale, compact labels, 8 px spacing rhythm, 12–20 px radii, comfortable content widths and 44 px minimum touch targets.

## Token targets

| Role | Light | Dark |
| --- | --- | --- |
| Page background | `#F7F9FC` | `#11141B` |
| Primary surface | `#FFFFFF` | `#1A1F29` |
| Elevated surface | `#FFFFFF` | `#232936` |
| Primary text | `#20242D` | `#F2F0F7` |
| Secondary text | `#78818E` | `#A7A8B5` |
| Primary accent | `#8B83E8` | `#ADA4F5` |
| Soft accent | `#EFEDFF` | `#302D45` |
| Blue accent | `#A9CCF5` | `#34445C` |
| Secondary accent | `#D77A63` | `#E99A82` |
| Divider | `rgba(80,95,115,.12)` | `rgba(229,232,242,.12)` |
| Glass | `rgba(255,255,255,.62)` | `rgba(26,31,41,.72)` |
| Strong glass | `rgba(255,255,255,.78)` | `rgba(35,41,54,.88)` |

Use existing semantic CSS variables where possible. Accent and text combinations must remain legible; solid fallback surfaces preserve contrast. First-time users default to light, existing saved modes remain respected.

The brighter `#8B83E8` remains a decorative lavender. Small text and filled actions use the deeper violet `#6B63CE` for contrast; the coral foreground token is similarly darkened in light mode.

## Page application

| Page | Glass use and composition |
| --- | --- |
| Today | Floating navigation and compact Moments/activity panel; open timeline with crisp media and balanced feed width; suggestions float as a secondary shelf on wide screens. |
| Discover | Editorial mixed-size masonry, creator attribution and compact glass filter/search controls. |
| Watch | Large portrait video stage with glass floating actions, creator context, and an adaptive comments drawer. |
| Inbox | Glass inbox pane, selected conversation canvas and translucent composer; details remain available through an on-demand drawer. |
| Profile | Light floating identity panel, elegant stats, translucent tabs and media-first collection. |
| Settings | Glass section navigation and dialogs; form groups remain readable and use actual supported settings only. |

## Interaction and motion

- Page transitions: 180–240 ms fade with 6–12 px travel.
- Glass panels, drawers and menus: opacity plus a restrained `.985` to `1` scale over 180–240 ms.
- Buttons: subtle hover lift and small press scale; visible focus always wins over hover styling.
- Feed items and incoming messages: brief, low-distance entrance only; do not animate the full list.
- Story rings: a quiet violet/blue identity accent, animate only when there is meaningful new activity.
- Skeletons: low-contrast shimmer; preserve current loading, empty, and error behavior.
- Use the existing CSS easing/timing tokens, no new motion dependency, and disable nonessential motion for `prefers-reduced-motion`.

## Responsive and accessibility constraints

Use adaptive layouts at 1920, 1440, 1024, 390, and 360 CSS pixels. Navigation collapses for mobile; panes become focused single-column views; media remains prominent. Avoid fixed widths, horizontal page overflow, blur-dependent contrast, color-only status, and hit targets below 44 px. Preserve all existing social, privacy, messaging, recommendation, media, and call behavior.

## Validation scope

This pass uses frontend lint and source-level checks only. The current brief explicitly forbids browser automation and screenshot capture; do not claim a screenshot comparison.
