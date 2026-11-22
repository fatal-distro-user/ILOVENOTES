# PDF

ILOVENOTES has a multi-page PDF viewer with annotations (pdf.js for display, pdf-lib for export). PDFs are stored inside your workspace, so they are included in backups.

## Importing

- Switch a page to **PDF** mode and choose **Import PDF...**, or drag a PDF file onto the page.
- A page can hold **several PDFs**. When there is more than one, a strip of file names at the top switches between them. "Add another PDF" in the toolbar imports more.
- Text from up to the first 200 pages is indexed so that search and the command palette can find the PDF by content (only when the page has no other text yet).
- To work on a PDF alongside other content, drop it onto a [canvas](canvas.md#pdf-pages-on-a-canvas) instead, or use the "Place pages on a new canvas" toolbar button, which copies the PDF and its annotations to a new canvas page with each page as an object.

"Remove this PDF" in the toolbar deletes the PDF and its annotations from the page after confirmation.

## Viewing

The toolbar has zoom out, zoom in (25% to 500%) and **Fit width**, which is on by default.

## Annotating

Pick a tool from the toolbar (they are also command-palette entries named "PDF: Highlighter", "PDF: Ink pen", "PDF: Sticky note", "PDF: Select"):

| Tool | How to use it |
| --- | --- |
| Select text / annotations | Click an annotation to select it; a small bar lets you recolor, copy its text or delete it |
| Highlight text | Select text on the page |
| Underline text | Select text |
| Strike through text | Select text |
| Ink pen | Draw freehand; width is set in the color popover (0.5 to 12) |
| Sticky note | Click to drop a note, then type its text. Notes can be edited or deleted later |
| Erase annotation | Click an annotation to remove it |

The color button sets the annotation color. Text highlights depend on the PDF having selectable text; scanned PDFs without a text layer can still be marked up with ink and sticky notes.

The **Annotations** panel in the right dock lists every annotation on the current PDF by page. Click an entry to scroll to it and select it.

Annotation edits have their own undo history (`Mod+Z` / `Mod+Shift+Z`) while the PDF is the active surface.

## Exporting

Two buttons in the toolbar open the same page picker:

- **Export annotated** writes `<name>-annotated.pdf`. You can choose which pages to include (All, Annotated only, or individual pages) and whether to **burn annotations into the pages (flatten)**. Highlights, underlines, strike-throughs, ink and sticky notes are drawn into the page content.
- **Extract pages** writes a new PDF with just the pages you select, named from the page numbers. It starts with the annotated pages selected.

The Export dialog (`Mod+Shift+E`) also offers "Annotated PDF" for a PDF page. See [Import and export](import-export.md).

Notes:

- The exported file is a standard PDF produced by pdf-lib, with ILOVENOTES as the producer. Annotations are flattened into the page graphics, not written as editable PDF annotation objects.
- If you untick the flatten option, the pages are exported without any annotations drawn on them.
