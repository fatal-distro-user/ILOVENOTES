# Animation

ILOVENOTES has a 2D flipbook animator built on top of the [paint studio](paint-studio.md)'s layer stack. There is no separate animation document: you turn the timeline on for a painting and its layers become frames.

## How frames work

- Each **top-level layer or group** is one frame. Frames play from the bottom of the layer stack to the top.
- Layers marked **pinned** show on every frame (use "Pin as background" for a backdrop). Adjustment layers also apply to every frame.
- Because a frame can be a group, you can build one frame out of several layers (for example line art and color).
- Each frame has a **hold** value (1 to 24) to keep it on screen for extra ticks, shown as `x2`, `x3` and so on.

## Turning it on

Open a painting and click **Animate** in the studio header. This shows the timeline bar under the workspace. If the painting has no frames yet, a layer named "Frame 1" is created. Click Animate again (or the close button on the bar) to hide it.

## Timeline controls

| Control | What it does |
| --- | --- |
| Previous / next frame | `,` and `.` (also buttons) |
| Play / pause | `Alt+Space` (also a button) |
| Playback mode | Loop, Ping-pong or Play once |
| FPS | 1 to 60 frames per second |
| Frame strip | Click a frame to select it; drag to reorder |
| Frame (add), Duplicate, Delete | Manage frames. The last remaining frame cannot be deleted |
| Hold | Increase or decrease how long the selected frame stays |
| Pin as background / Unpin all | Show a layer on every frame, or clear pins |

While you edit, only the selected frame is shown on the canvas. The animation shortcuts only work while the timeline is enabled and a painting tab is active. The same actions are in the command palette as "Animation: Previous frame", "Animation: Next frame" and "Animation: Play / pause".

## Onion skinning

The **Onion** section of the timeline overlays ghost images of neighbouring frames in color so you can line up your drawing: one tint for the previous frame (red by default) and one for the next (green by default). You can change both tints, how many previous and next frames are shown (0 to 5 each; the default is one of each) and the onion opacity.

## Exporting

Use **Export** on the timeline bar:

| Option | Output |
| --- | --- |
| Animated GIF | A looping GIF (it does not loop in Play once mode), honoring FPS and hold |
| Animated GIF (2x pixels) | The same at double pixel size, useful for pixel art |
| Sprite sheet PNG | All frames laid out in a grid, named with the grid size, for example `-sheet-4x3.png` |
| WebM video | A video recorded from the frames; needs `MediaRecorder` support in the browser or runtime |

Pinned layers are included in every exported frame. For other paint exports (PNG, ORA, PSD) see [Import and export](import-export.md#paint-exports).

## Tips

- Use the **Pixel-art canvas** (64 x 64) with the pixel brushes and the 2x GIF export for sprite animation.
