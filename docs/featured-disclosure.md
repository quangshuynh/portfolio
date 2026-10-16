# Featured projects: technical-details disclosure

Each featured project's implementation bullets now sit behind an
"Explore technical details" / "Hide technical details" toggle. Title, type,
summary, takeaway, stack, imagery, gallery tabs, and links stay visible.

## Behaviour

- Every project starts collapsed and expands independently.
- The toggle is a native `<button>` with `aria-expanded` and `aria-controls`,
  described by its project title (`aria-describedby`) so six identical labels
  stay distinguishable in a screen reader's button list.
- The bullets stay in the DOM. While collapsed the panel is `inert` and
  `visibility: hidden`, so it is neither focusable nor announced; Tab moves from
  the toggle straight to the project's links.
- The panel animates `grid-template-rows` from `0fr` to `1fr` with the shared
  `--dur-base` / `--ease-out` tokens; the chevron rotates and the list fades in.
  The global `prefers-reduced-motion` rule reduces these to effectively instant.
- Flagship (wide) card: takeaway sits beside the purpose, and the expanded list
  runs full width in two columns. Below 1180px it falls back to one column.
- Phones: the disclosure keeps the bullets' previous slot (after the takeaway,
  before the stack).

## Measurements (1440×900 desktop, 390×844 mobile)

| Featured list height | Before | After, all collapsed |
| --- | --- | --- |
| Desktop | 5,702px | 4,247px (−25%) |
| Mobile | 9,110px | 6,702px (−26%) |

Screenshots: [`featured-disclosure/before`](featured-disclosure/before) and
[`featured-disclosure/after`](featured-disclosure/after) (585Dashcam585 and
DashPilot, collapsed and expanded, desktop and mobile).
