# Paint studio

The paint studio is a layered raster painting environment. A painting is a **paint frame**: a raster document stored on a canvas page. It can live on a [canvas](canvas.md), or be embedded in a document as a [sketch frame](notes-editor.md#sketch-frames).

For the full list of paint shortcuts, see [Paint shortcuts in the README](../README.md#paint). Paint shortcuts only apply while a painting tab is active.

## Opening and creating

| Command (palette) | Result |
| --- | --- |
| New painting (`Mod+Alt+N`) | 1920 x 1080 painting on a new page |
| New painting (2048 x 2048) | Square painting |
| New pixel-art canvas (64 x 64) | Small canvas for pixel art |

Double-click a paint frame on a canvas to open it in the studio, which opens as its own tab. The header shows the painting name (editable), the active tool's options, **Animate**, **Filters**, **Guides**, fit-to-view (`Mod+0`), canvas size (click to resize), **PNG** export and **Export...** for layered formats.

Panels for Layers, Brushes and Color appear in the right dock while a painting is active.

## Layers

Open the **Layers** panel. Layer kinds you can add: Raster, Vector, Text, Group, and **Adjustment** layers (non-destructive versions of the filters listed below, with an Adjust button for numeric parameters).

Per-layer controls:

- **Blend mode**: Normal, Multiply, Screen, Overlay, Darken, Lighten, Color dodge, Color burn, Hard light, Soft light, Difference, Exclusion, Hue, Saturation, Color, Luminosity (16 in all).
- **Opacity** slider, visibility and lock toggles.
- **Alpha lock**: paint only on existing pixels.
- **Clipping mask**: clip the layer to the one below.
- **Reference layer**: fill and magic wand can sample this layer instead of the whole image.
- **Layer mask**: add one (from the selection if there is one), paint on it, disable it or apply it. A "Editing mask" badge shows while you paint on the mask.
- Layers can be reordered by drag and drop and grouped.

Actions: New layer (`Mod+Shift+N`), Duplicate (`Mod+J`), Merge down (`Mod+E`), Delete, and in the More menu: Merge visible, Flatten image, Apply layer mask.

## Brushes

The Brush, Eraser and the retouch tools (Smudge, Blur, Sharpen, Clone stamp, Healing brush) all use the same engine and presets. The tool options bar has **Size**, **Opacity**, **StreamLine** (a stabilizer that smooths your stroke) and a **lazy mouse** (pull-string) option, plus a preset picker.

Built-in presets cover ink (fineliner, fountain pen, felt marker, highlighter), sketch (pencil, charcoal), paint (watercolor with wetness, oil with bristles), airbrush, pixel (pixel brush and dither), retouch tools and soft and hard erasers.

The **Brushes** panel is the Brush Studio. It edits the selected preset with sliders such as size, flow, spacing, hardness, angle, roundness, scatter, size, opacity and angle jitter, taper, texture grain, pressure to size and opacity, tilt shading, velocity thinning, wetness (color mixing), bristles, default StreamLine and retouch strength. You can also choose the tip shape and blend options. Presets can be exported and imported as `.brush.json` files; custom ones are stored in your workspace database.

Pressure and tilt are used when your pen and browser provide them. With a mouse, pressure is simulated.

## Selection

| Tool | Notes |
| --- | --- |
| Lasso (`L`) | Freehand selection |
| Polygonal lasso | Click points (no key) |
| Magic wand (`W`) | Tolerance, contiguous toggle, and sampling from all layers, the current layer or the reference layer |

Selection mode is replace, add, subtract or intersect (hold `Shift` to add, `Alt` to subtract, `Shift+Alt` to intersect). Options include feather and anti-aliasing.

Commands: Select all (`Mod+A`), Deselect (`Mod+D`), Invert (`Mod+Shift+I`), Select layer pixels, Feather (`Mod+Alt+F`), Expand and Contract selection. Copy (`Mod+C`), Copy merged (`Mod+Shift+C`), Cut (`Mod+X`) and Paste as new layer (`Mod+V`). `Delete` clears selected pixels and `Alt+Backspace` fills the selection with the primary color. Flip horizontal and flip vertical are commands too.

**Free transform** (`T` or `Mod+T`) scales, rotates, distorts and warps a layer or selection; apply it with the "Paint: Apply transform" command or by confirming in the tool. **Move layer** is `V`.

## Fill

- **Paint bucket** (`G`): flood fill with tolerance and a contiguous option, sampling from all layers, the current layer, the reference layer, or automatically (reference layer if one is set).
- **Gradient fill**: no key.
- **Fill selection with color**: `Alt+Backspace`.

## Guides

Open **Guides** in the header:

- **Symmetry**: Off, Vertical, Horizontal, Quadrant, Radial (with a segment count and a kaleidoscope mirror option).
- **Perspective**: Off, 1-Point, 2-Point or Isometric, with an option to snap strokes to the perspective directions.
- **Ruler**: Hidden, Ruler, Protractor or French curve. Strokes are constrained to the ruler while it is visible.
- **QuickShape**: hold at the end of a brush stroke to snap it to a recognized shape.

Use the **Edit guides** tool (compass icon) to move symmetry centers, vanishing points and rulers.

## Color

The **Color** panel has primary and secondary swatches (swap and reset buttons), an HSV color wheel or square picker, alpha, and value inputs for HEX, RGB, HSL, HSV and CMYK. Below that:

- **Recent** colors.
- **Harmony**: complementary, analogous, triadic, split-complementary, tetradic and monochromatic suggestions, which you can add to the active palette.
- **Palettes**: create, import (`.gpl`, `.hex`) and export (`.gpl`) palettes, and extract a palette from an image ("Color: Extract palette from image...").
- **Eyedropper** (`I`) picks a color from the canvas.

## Filters

Open **Filters** in the header (or search "Filter:" in the command palette). Each opens a dialog with a live preview toggle and runs in a background worker:

Hue / Saturation / Lightness, Brightness / Contrast, Curves, Levels, Color Balance, Gaussian Blur, Motion Blur, Pixelate / Mosaic, Sharpen, Halftone, Chromatic Aberration, Noise / Grain, Threshold, Invert.

Filters apply to the active layer, limited to the current selection when there is one. To keep them editable, add the same effect as an Adjustment layer.

## Undo

A painting has its own undo history. Raster edits are stored as tile differences with a memory cap, and the History panel lists entries you can jump between.

## Exporting

PNG (flattened) from the header, and OpenRaster, Photoshop PSD and layer PNGs from **Export...**. See [Import and export](import-export.md#paint-exports). For frame-by-frame animation see [Animation](animation.md).
