# Design System: Ranked Match Hall

## 1. Overview & Creative North Star

### Creative North Star: "The Apex Nexus"
The design system is engineered to evoke the high-stakes atmosphere of a futuristic command center. It rejects the "flat" web aesthetic in favor of **The Apex Nexus**—a philosophy of depth, kinetic energy, and digital prestige. We are not just building a menu; we are building a portal to competition. 

To move beyond the "template" look, this system utilizes **intentional asymmetry** and **overlapping geometry**. Layouts should feel like sophisticated tactical HUDs where primary actions (like the 'Start Match' button) break the container boundaries, and statistics breathe through expansive typography scales. We prioritize "feeling" the UI through light and motion rather than rigid structural lines.

---

## 2. Colors & The Surface Manifesto

The palette is rooted in the depth of space, using high-contrast accents to guide the player’s competitive drive.

### The Color Tokens
- **Background Core:** `#0b0e14` (Deep Navy/Charcoal)
- **Primary (Ranked Energy):** `primary` (#8ff5ff) – Use for active states and critical information.
- **Secondary (High-Tier Prestige):** `secondary` (#ffd709) – Reserved for "Gold" tier rewards and top-level victory states.
- **Tertiary (System Status):** `tertiary` (#8eff71) – Active/Ready indicators.

### The "No-Line" Rule
**Explicit Instruction:** Do not use 1px solid borders to define sections. In this design system, boundaries are created through:
1.  **Background Shifts:** Placing a `surface-container-high` card against a `surface` background.
2.  **Tonal Transitions:** Using subtle gradients to suggest an edge rather than drawing one.
3.  **Glow-Based Edges:** Using an inner glow (Primary-Dim at 10% opacity) to define the perimeter of interactive cards.

### Glass & Gradient Signature
To achieve a AAA "High-Fidelity" look, all floating panels must use **Glassmorphism**. 
- **Effect:** Apply `surface-container` colors at 70% opacity with a 20px - 40px Backdrop Blur.
- **Soulful Gradients:** Main CTAs must transition from `primary` to `primary-container` at a 135-degree angle to create a sense of metallic sheen and volume.

---

## 3. Typography: The Tactical Voice

Our typography balances the high-performance geometry of **Space Grotesk** with the utilitarian readability of **Manrope**.

| Tier | Token | Font Family | Size | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Display** | `display-lg` | Space Grotesk | 3.5rem | Critical Rank Ups / Tier Names |
| **Headline** | `headline-lg` | Space Grotesk | 2rem | Section Headers (e.g., "Ranked Match Hall") |
| **Title** | `title-md` | Manrope | 1.125rem | Card Titles / Sub-headers |
| **Body** | `body-md` | Manrope | 0.875rem | Player Stats / Description Text |
| **Label** | `label-sm` | Manrope | 0.6875rem | Small Utility Metadata |

**Editorial Note:** Use all-caps for Space Grotesk headers to emphasize the "Futuristic Competitive" tone. For numerical data (K/D ratios, points), use `display-sm` to create a visual hierarchy that highlights performance.

---

## 4. Elevation & Depth: Tonal Layering

We abandon traditional drop shadows for **Ambient Tonal Layering**.

- **The Layering Principle:** 
    - Base Floor: `surface-container-lowest`
    - Main Panels: `surface-container-low` 
    - Interactive Cards: `surface-container-high`
- **Ambient Shadows:** When an element must "float" (e.g., Tooltips), use a shadow tinted with `surface-tint` (#8ff5ff) at 5% opacity. The blur should be high (30px+) to mimic the way light disperses in a high-tech environment.
- **The Ghost Border:** If accessibility requires a stroke, use `outline-variant` (#45484f) at 15% opacity. It should be felt, not seen.
- **Inner Glows:** Top-tier components (Gold/Amber) should use a subtle inner shadow `secondary-container` at the top edge to simulate overhead "stadium lighting."

---

## 5. Components

### High-Impact 'Start Match' Button
- **Style:** Gradient fill (`primary` to `primary-container`). 
- **Animation:** A constant "breathing" outer glow (0px to 8px spread). On hover, a diagonal "light sweep" (white at 20% opacity) must pass across the button face.
- **Border-Radius:** `full`.

### Segmented Controllers (Solo/Duo/Trio)
- **Style:** `surface-container-highest` background. The selected state uses a `primary` glow behind the text and a subtle metallic texture overlay.
- **Nesting:** Placed inside a `surface-container-low` panel to create a recessed, "molded" look.

### Ranked Progress Bars
- **Style:** The track uses `surface-container-lowest`. The fill uses a gradient of `primary` to `primary-dim`.
- **Flow Effect:** A repeating linear-gradient animation moves through the fill color to simulate "flowing data" or "energy."

### Glossy Multi-Layered Cards
- **Style:** Background shift using `surface-container-high`. 
- **Detail:** Use a 1px "Ghost Border" at the top and left edges only to simulate a light source reflecting off a beveled edge.
- **Spacing:** Use `spacing-6` (1.5rem) for internal padding to maintain a premium, airy feel.

### Detailed List Items (Leaderboard)
- **Constraint:** NO divider lines. 
- **Interaction:** On hover, the list item background shifts to `surface-bright`. A `primary` vertical sliver appears at the far left (2px width) to indicate selection.

---

## 6. Do's and Don'ts

### Do
- **Do** use `spacing-px` and `spacing-0.5` for ultra-fine details in "scanning" animations.
- **Do** layer `primary-fixed-dim` text over `surface-container-highest` for maximum readability with a "neon" effect.
- **Do** use `xl` (1.5rem) roundedness for large containers to soften the "Brutalist" dark theme into a "Premium" experience.

### Don't
- **Don't** use pure white (#FFFFFF). Use `on-background` (#ecedf6) to avoid harsh eye strain in dark environments.
- **Don't** use standard "drop shadows." If it doesn't look like it's glowing or floating in a vacuum, it's too heavy.
- **Don't** crowd the UI. If a section feels tight, increase the `surface-container` shift rather than adding more borders or labels.
- **Don't** use 100% opaque borders. High-contrast lines shatter the "Apex Nexus" immersion.