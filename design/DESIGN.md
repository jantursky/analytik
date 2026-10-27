# Design system

Two surfaces share one set of tokens (`tokens.css`).

- **Product** (the dashboard and the demo): a cool grey page, white cards with small radii and an indigo primary. Calm and compact, with underlined tabs.
- **Editorial** (docs and landing): the same cool neutrals and indigo, with Figtree headings and small tracked labels.

Elevation comes from a light cool border plus a barely visible shadow. Only popups (select lists, the date picker, tooltips), dialogs and the cards on the realtime map float.

## Palette

| Token                                | Light                 | Dark                  | Use                                               |
| ------------------------------------ | --------------------- | --------------------- | ------------------------------------------------- |
| `--bg`                               | `#f2f4f8`             | `#0b1020`             | page background (cool grey / deep navy)           |
| `--surface`                          | `#ffffff`             | `#121a2c`             | cards, header, inputs, secondary buttons, dialogs |
| `--bg-subtle`                        | `#f7f8fb`             | `#161f33`             | hover fills inside cards, code blocks             |
| `--bg-muted`                         | `#e9edf3`             | `#1d2740`             | segmented-control tracks, badges                  |
| `--border`                           | `#e0e5ee`             | `#232e47`             | default 1px card and header border                |
| `--border-strong`                    | `#c9d0dc`             | `#34415f`             | inputs, hover borders, chart gridlines            |
| `--text`                             | `#101828`             | `#e9edf6`             | body and headings (never pure black)              |
| `--text-muted`                       | `#4a5568`             | `#a8b2c7`             | labels, helper text, inactive tabs                |
| `--text-faint`                       | `#5f6b7d`             | `#8f9ab0`             | placeholders, axis labels                         |
| `--primary` (`--accent` in the demo) | `#3a4fd8`             | `#8a97ff`             | primary button fill, active indicators            |
| `--on-primary`                       | `#ffffff`             | `#0b1020`             | text on the primary fill                          |
| `--disabled`                         | `#e3e7ef`             | `#263150`             | disabled button fill                              |
| `--accent-text`                      | `#3446c9`             | `#a3adff`             | links, selected check                             |
| `--accent-soft`                      | `#e9ecfd`             | `#1f2752`             | selected rows, chosen tiles, range days           |
| `--focus`                            | `#3a4fd8`             | `#a3adff`             | focus ring                                        |
| `--success` / `-soft`                | `#13995a` / `#dcf4e7` | `#3ddc84` / `#0f3024` | online dots, live state, up trends                |
| `--success-text`                     | `#0f6e42`             | `#7ee8ae`             | success notices on `--success-soft`               |
| `--revenue-soft`                     | `#d9f3ea`             | `#0f3028`             | revenue meter tracks and tints                    |
| `--violet-soft`                      | `#ece7fd`             | `#2a2350`             | avatar and category tints                         |
| `--warning` / `-soft`                | `#c9541f` / `#fde8dc` | `#f2925f` / `#3a2116` | warnings, errors, down trends                     |
| `--danger`                           | `#b42f2f`             | `#ff8a80`             | destructive confirm button fill                   |
| `--on-danger`                        | `#ffffff`             | `#0b1020`             | text on `--danger`                                |

Inside the dashboard every token is `--analytik-*`; the demo's `tokens.css` and the docs theme (`--blume-*`: background, muted, border, foreground, accent) use the same values.

Every text pair above meets WCAG AA (4.5:1) on `--bg`, `--surface` and, for row labels, on `--accent-soft`.

### Chart series

In order: indigo `#5b6cf0` (visitors), green `#19a97b` (revenue), amber `#f0a03c`, pink `#d65f9b`. Dark: `#7c89ff`, `#2fc796`, then the same amber and pink. Series colours are never used for text; a legend square next to the label ties a number to its series. Area fills are a vertical gradient of the series colour (see Charts), gridlines are dashed `--border-strong`.

### Realtime map

An indigo-navy canvas: background `#0c1024`, land dots `#2c3570`, graticule `#161c3d`, markers in `--success`. Floating cards use `rgb(17 22 48 / 0.82)` with a 10px backdrop blur, text `#eceffd`, secondary text `#aab2d6`. The light map variant swaps to background `#eef0fb`, land `#b5bde6`, graticule `#dde1f5`, white cards (`rgb(255 255 255 / 0.85)`) with `#101828` / `#4a5568` text.

### Logo

A blue triangle (`#3a8dff`) with a yellow upper-left face (`#ffc232`), cut from the rest by a diagonal transparent gap. The colours come from the artwork, not from the UI primary, and are the same in light and dark. The mark appears in the dashboard header (`BrandMark`), the favicons, the docs logo and the README banner (mark, "Analytik" wordmark and tagline).

## Typography

- **Figtree** (variable, `@fontsource-variable/figtree`, OFL): all UI text and every heading, product and editorial. Weights 400, 500, 600, 700. The dashboard names `'Figtree Variable'` first and falls back to the system sans; the package does not bundle fonts.
- **Geist Mono** (`@fontsource/geist-mono`): code, IDs, snippets, and the values in chart tooltips.

No serif.

Scale (base 14px for UI, 16px for prose): 11 / 12 / 13 / 14 / 16 / 18 / 22 / 26 / 30 / 36 / 40. Line height 1.43 for UI, 1.5 for prose.

- Page headings: 30 to 36px, weight 700, letter spacing -0.02em.
- Stat numbers: 26px 700 in the stat strip, 40px 700 on site cards, tabular numbers.
- Card titles: 16px 700. Labels: 13px 500 `--text-muted`.
- Column headings and footer links ("VISITORS", "DETAILS"): 11px 600 uppercase, `letter-spacing: 0.08em`.

## Spacing, radius, borders

- Base unit 4px: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Max content width 1240px. Card padding 20px, dialogs 24 to 28px.
- Radius: bar rows 6px, controls (buttons, toolbar controls, pills, chips) 8px (`--analytik-radius-control`), badges 6px, inputs 8px, popups 12px, cards and dialogs 12px, feature cards 16px. Nothing is fully round except avatars, dots and the Overview "+" handles.
- Borders: 1px `--border` on every card, header and control.
- Shadows: cards `0 1px 2px rgb(16 24 40 / 0.05)` and controls `0 1px 1px rgb(16 24 40 / 0.04)` (none in dark mode); popups `0 1px 2px rgb(16 24 40 / 0.06), 0 12px 32px -8px rgb(16 24 40 / 0.2)`; dialogs `0 24px 64px rgb(0 0 0 / 0.16)` over a backdrop of `rgb(16 24 40 / 0.4)`.

## Components

- **Header**: `--surface` with a 1px bottom border, holding the brand mark and the main nav. Header and toolbar are sticky; the toolbar sits under the header on a translucent `--bg` with a backdrop blur. On phones only the toolbar sticks, as one row that scrolls sideways. `--analytik-sticky-top` offsets both below a host page's own sticky bar.
- **Primary button**: `--primary` fill, `--on-primary` text, 8px radius, 38px high, 16px side padding, weight 600. One per surface. Disabled: `--disabled` fill with muted text, no opacity trick.
- **Secondary button**: `--surface`, 1px `--border`, same size. Hover darkens the border.
- **Toolbar**: a row of 8px-radius controls: site switcher (initial tile + select), date range (previous/next arrows around the preset select), interval select, a "Live" toggle with a status dot, a refresh icon button, and "Customize" / "Done" on Overview.
- **Card**: `--surface`, 1px `--border`, 12px radius, card shadow.
- **Stat strip**: inside the main card, tiles separated by 1px dividers; label 13px muted with an optional series square or status dot, value 26px 700, delta.
- **Delta**: `.analytik-delta[data-trend]`, small text with an up or down arrow icon; `--success` for up, `--warning` for down.
- **Main nav and tabs**: no pills. The active item is `--text` with a 2px `--primary` bar under it that slides between items; inactive items are `--text-muted`. Keyboard: arrows, Home, End.
- **Bar list row**: a label row (name, mark, count right-aligned in 600) with a slim 3px meter underneath: a `--bg-muted` track and a fill (`--series-1`) that grows from the left in proportion to the value. Revenue meters use `--series-2`. Rows are 6px radius and highlight on hover.
- **Badge**: 6px radius, `--bg-muted` fill, 12px 500.
- **Site tile**: the site's favicon on white, over its initial on a pastel square; the initial stays when there is no icon. The site switcher lists name, domain and tile.
- **Site card**: site tile, name and domain, a big visitor number, "N online" with a green or grey dot.
- **Dialog**: centred, 12px radius, dimmed backdrop, primary button at the bottom.
- **Input**: `--surface`, 1px `--border-strong`, 8px radius, 38px high; focus darkens to `--text`. A validation message sits under the field as small `--danger` text and the border turns `--danger`.
- **Focus**: 2px `--focus` outline, 2px offset, on every interactive element; inset on tabs, and on the Live toggle rather than its switch.
- **Notice**: the result of an action, left of the buttons it came from. Success is a green chip with a check (`--success-soft`, `--success-text`) that fades out after 2.6s; an error is a warning chip that stays.
- **Button rows** at the end of a card or form align right.
- **Confirm dialog**: destructive actions (rotate the API key, delete data, delete a funnel) open a dialog that says what happens, with Cancel and a solid `--danger` button.
- **Choice tiles**: radio options as bordered tiles in a grid; the chosen one gets a `--primary` border on `--accent-soft`.
- **Marks**: browsers, operating systems and payment providers get their 14px logo in its own colours (Gilbarbara logos and Simple Icons, both CC0, loaded lazily); logos that are plain black (Apple, Threads, X) take `--text-muted`, so they show on the dark theme. Devices get a stroke icon. Rows without a mark keep the empty slot so names line up.
- **Data table** (sessions, events, payments): a count badge next to the card title; a tool row with a search field (debounced 250ms), filter chips (each with a remove button), the table's own date range and "Clear"; sortable headings (down arrow for descending, up for ascending, a third click resets); rows highlight on hover and open the visitor timeline in a wide dialog. Below, "1–25 of 312", a rows-per-page select and numbered page buttons with gaps; the current page is a `--primary` button. While a page loads the old rows stay and dim. An empty result says "Nothing matches these filters" with a "Clear filters" button.
- **Visitor cell**: a round avatar with a gradient picked from the visitor id, and the id's last six characters in mono; places show a flag, country and city; devices the browser mark and "Device · Browser"; paths "entry → exit".
- **Table cell actions**: in the visitor cell, a copy-id icon button revealed on row hover; after copying it shows an animated green checkmark for a moment. Next to it a "show only this visitor" filter button. Both are always visible on touch devices.
- **Filter chip**: 8px radius, `--accent-soft` fill, label and a small remove button.
- **Time zone picker rows**: name on the left, the UTC offset and the current local time right-aligned in muted mono.
- **Currency picker**: a searchable list of every ISO 4217 currency, the common ones first; each row is a symbol tile, the code and the English name. Typing matches code or name.

## Do

- Put content on white cards on the cool grey page.
- Use the 8px control radius for every button and toolbar control.
- Reserve the indigo primary button for one action per surface.
- Support light and dark with the same token names; dark keeps the same structure on navy cards.
- Respect `prefers-reduced-motion`: pulsing dots and map halos stop, transitions and Recharts animations switch off, numbers jump instead of counting, Motion keeps only opacity fades.

## Don't

- Warm or beige neutrals.
- Heavy shadows, glows, or gradients anywhere but the soft fills inside charts.
- Pure `#000` body text.
- Series colours as text colours.
- Pill shapes: nothing but avatars, dots and handles is fully round.
- Motion that moves layout for its own sake: animate to explain a change (a new value, a new row, an opened panel).

## Controls (dashboard)

Built on Base UI primitives, written as small copy-in modules in `src/dashboard/ui/` and styled with the `--analytik-*` variables (no Tailwind needed by consumers).

- **Select**: an 8px-radius trigger with a chevron that turns when open; the list is a 12px-radius popup with `--shadow-popup`, 6px-radius rows, a highlighted row on `--bg-muted`, a check in `--accent-text` for the chosen one.
- **Combobox** (time zones): an input that filters a list of at most 60 matches.
- **Date range**: one control: previous arrow, a calendar-icon trigger with the preset name or the days ("Oct 1 – 3, 2026"), next arrow. The popover lists the presets on the left (a row of chips on phones) and a Monday-first month grid on the right; range ends are `--primary` fills with `--on-primary` text, the days between sit on `--accent-soft`, today has a dot. Presets apply at once, a picked range with "Apply".
- **Switch**: 34×20 track, 16px white thumb centred vertically with 2px inset, sliding 14px; `--border-strong` off, `--success` on. Used for Live and for on/off settings.
- **Tabs**: the 2px underline bar slides between tabs.
- **Tooltip**: an inverted (`--text` on `--surface`) 6px-radius label, 12px 500.
- **Dialog**: centred on wide screens; under 640px a bottom sheet with 12px top corners and a grab handle.
- Popups render inside the dashboard root so they keep its theme; parts used on their own get the `analytik-layer` class with the default tokens.

## Overview customisation (dashboard)

The toolbar's "Customize" button turns Overview into an editor (the label becomes "Done", and a quiet "Reset" button with a confirmation dialog appears next to it). In editing state each block gets a dashed outline; hover highlights it with a `--primary` border and a soft shadow. Round "+" handles on a block's left and right edge insert a block before or after it. A block bar offers move earlier, move later, a Full / Half width toggle and remove. A dashed "Add a block" tile closes the grid.

The summary block stays interactive while editing: each number becomes a small card (a select for the metric, its value, a remove button) with a dashed "Add a number" card after them, and a dashed panel above the chart holds a "Chart" row of toggle chips (pressed: `--primary` border, `--accent-soft` fill, the series marker), one to four metrics. Outside the editor a number is a toggle: pressed, it gets an `--accent-soft` fill with a 2px `--accent-text` underline and joins the plotted metrics, up to four, coloured `--series-1` to `--series-4` in the order picked (the tile's marker matches). Each metric keeps its form (area for counts, only the first filled; bars for money and durations, grouped when several; a line without fill for rates). Metrics share an axis per kind: left for the first, right for the second, hidden scales after that. A "A, B and C over time" heading, a hint and a link back sit above the chart.

### Block picker

A large dialog: a category list with counts on the left, a grid of block cards on the right. Each card has a category badge, a mockup of the block with sample numbers (bars with labels and values, a small table, a donut with a legend, tiles with sparklines, a feed) drawn as a mini card, and a description; two cards per row on wide screens; the selected card gets a `--primary` outline. The footer holds a note, Cancel and a primary "Add block". On phones it is a bottom sheet and the categories become a horizontal scroller.

### Catalogue blocks

- **KPI tile**: icon, label, value and delta, with a sparkline.
- **Channel table**: traffic channels with visitors and share.
- **Device donut**: device split as a donut with a legend.
- **Funnel bars**: one bar per step, the drop-off to the next step hatched.
- **Average order value**: one big number with its delta.
- **Recent payments**: a feed of latest payments.
- **Live feed**: visitors and events as they arrive.

## Settings (dashboard)

A list of sections on the left (a scrolling row on phones) with the chosen one marked by the underline or a `--accent-soft` fill: General, Privacy, Tracking code, Campaign links, Payments and API, Data. Every card has a title and a one-line description. The campaign link builder shows a preview: the link with its `utm_*` parameters highlighted, a tile per parameter saying what it means, and where the visits will show up.

## Charts (dashboard)

Recharts, loaded with the first chart (a lazy chunk), in a soft style: the area is the series colour with a vertical gradient from 38% to 2% opacity and a 2.25px monotone line; revenue bars use a gradient of `--series-2`, 4px top radius, at most 14px wide, on a right-hand axis. Only horizontal dashed gridlines (`3 5`, `--border-strong`), no axis lines or tick marks, 11px `--text-faint` labels, three ticks on a "nice" scale. The tooltip is a blurred card that glides between points with a dashed cursor line; the legend above the chart is a row of buttons that switch series on and off. Series enter with a 0.7 to 0.9s ease-out and animate between data updates. Every chart has a text summary and a screen-reader table of its values.

## Motion (dashboard)

Motion (`motion/react`) for what CSS cannot do; CSS transitions on Base UI's `data-starting-style` / `data-ending-style` for popups and dialogs.

- Ease `cubic-bezier(0.22, 1, 0.36, 1)`; entrances 250 to 350ms, exits 120 to 200ms.
- Views fade up 8px with their cards staggered by 50ms and fade out when another view replaces them; the active nav underline slides to the chosen item.
- Bar-list rows fade in and their meters grow from the left; switching a tab keeps the old rows until the new ones load, then cross-fades (160ms, opacity only); filter chips scale in and out.
- Stat values count to their new value over 600ms.
- Realtime: the globe turns by dragging or with the arrow keys; the globe and light-map choices are remembered in the browser. New map markers pop in on a spring with a one-off ripple, places nobody is at fade out, feed lines slide in from the top and push the others down, the online count counts.
