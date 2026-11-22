# Canvas

A canvas page is an infinite, pannable and zoomable surface for ink, shapes, text, sticky notes, images, mind maps, PDF pages, audio notes and paint frames. Set a page to **Canvas** mode, or use **Hybrid** to put a document beside it. Create one directly with `Mod+Shift+N`.

For the single-key tool shortcuts, see [Canvas shortcuts in the README](../README.md#canvas).

## Navigating

- Pan with the Hand tool (`H`), by holding `Space` while dragging, with the middle mouse button, or with the scroll wheel.
- Zoom with `Mod` + scroll wheel or trackpad pinch, the zoom buttons, `Mod+=` and `Mod+-`. `Mod+0` resets to 100%.
- `Shift+1` fits all content in view, and `Shift+2` fits the selection.
- The **minimap** shows the whole canvas; click or drag in it to navigate.
- The **Background and snapping** popover picks the background (Blank, Dots, Grid, Isometric, Hex, Ruled, Music staff, Cornell notes), the grid size, **Snap to grid** and **Smart alignment guides**. Snap to grid is also a command-palette entry.

## Tools

| Tool | Notes |
| --- | --- |
| Select | Click, drag a marquee, resize, rotate. Double-click or press `Enter` to edit text-like objects |
| Hand | Pan |
| Pen | Pressure-aware ink strokes; width, opacity and color in the tool style popover |
| Highlighter | Wide translucent ink |
| Stroke eraser | Erases whole strokes it touches; size is adjustable |
| Text | Click to add a text object |
| Rectangle, Ellipse, Diamond, Triangle, Line, Arrow | Vector shapes with stroke, fill and stroke width |
| Frame | A frame region for grouping content |
| Laser pointer | Temporary trail for presenting; nothing is saved |
| Sticky note, Connector, Mind map node, Audio note, Paint frame | Described below |

The toolbar also has **Insert image** and a **Tool lock** toggle. Normally the canvas returns to Select after you create something; with tool lock on, the current tool stays active. You can also drop image files onto the canvas.

With objects selected, a selection bar offers colors, alignment (left, centre, right, top, middle, bottom), distribute, bring to front / send to back, group, lock, duplicate and delete. Useful keys: `Delete`, `Mod+A`, `Mod+C`, `Mod+X`, `Mod+D` (duplicate), `Mod+G` (group), `Mod+Shift+L` (lock), `[` and `]` to change stacking order, and the arrow keys to nudge (`Shift` moves by 10).

## Sticky notes

Press `N` (or pick the tool) and click to place a 200 by 200 note in one of several pastel colors. It opens for editing at once. Notes render a small Markdown subset: headings `#` to `###`, bold, italic, `~~strike~~`, `==highlight==`, inline code, links, bullet, numbered and task lists (`- [ ]`), quotes and horizontal rules. `[[wiki]]` text is styled but is not a navigable link on a sticky.

Press `Esc` or `Mod+Enter` to finish editing.

## Connectors

Choose the Connector tool (`C`) and drag from one object to another. Connectors attach to ports on the object sides, follow the objects when they move, and can also have a free end. Connectors can be straight, orthogonal or curved (the default), with arrowheads at either end, a dashed style, and a color; select a connector to see these options. Selecting a single object shows port dots for quick connecting.

## Mind maps

Pick the **Mind map node** tool and click to create a "Central idea" node. While a node is selected or being edited:

- `Tab` adds a child node to the right, joined by a curved connector.
- `Enter` adds a sibling below.

Children inherit the parent's color. Because nodes are ordinary canvas objects, you can move, recolor and connect them like anything else. The "Mind Map" [template](knowledge.md#templates) starts you off with one.

## QuickShape

With **QuickShape (hold pen to snap)** enabled in the Background and snapping popover (it is on by default), draw with the pen and hold still at the end of the stroke for roughly half a second. If the stroke looks like a line, arrow, circle, ellipse, rectangle, triangle, star or polyline, it is replaced by an editable vector shape you can resize and style. Otherwise the stroke stays as drawn.

## Ink to text and ink to diagram

Select some pen strokes (with the marquee) and use the small bar that appears below them, or the command palette:

- **Ink to Text** (command "Canvas: Convert selected ink to text (OCR)") runs optical character recognition on the strokes and replaces the strokes with a text object. It uses tesseract.js with the English model, which is **downloaded on first use** and then cached. Neat, print-style writing works best; cursive or messy handwriting is recognized poorly, so expect to correct the result.
- **Ink to Diagram** (command "Canvas: Convert selected ink to diagram") turns rough sketched shapes into clean shape and connector objects (the original strokes are replaced), using the same shape recognizer as QuickShape. It is a heuristic and can misread rough sketches.

## Audio notes

Open the audio panel with `Mod+Shift+R`. `Mod+Alt+R` starts and stops recording on the current page (microphone permission is requested by your browser or OS). Recordings belong to the page and are listed in the panel, where you can play, pause, **pin to canvas**, download or delete them.

On a canvas, the **Audio note** tool records and places a clip: click to start, then click again where you want the player to sit. While recording on a canvas, pen strokes you draw are tagged with their time offset. During playback of that clip, strokes light up as they were "spoken" and strokes not yet reached are dimmed, so ink follows the audio.

## Paint frames

The **Paint frame** tool (`B`) lets you drag out a rectangle, which creates a new raster painting there and opens it in the [paint studio](paint-studio.md). Double-click a paint frame later to reopen it. To start with a standalone painting, use "New painting" (`Mod+Alt+N`).

## PDF pages on a canvas

Drop a PDF onto the canvas, or run "Canvas: Import PDF pages onto canvas" from the command palette. Each page becomes an object, stacked vertically. See [PDF](pdf.md).

## Export

A canvas page exports to SVG (vector) or PNG at 2x, and to Markdown, from the Export dialog (`Mod+Shift+E`). See [Import and export](import-export.md).
