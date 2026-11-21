// Generates small deterministic test fixtures (PDF with selectable text) used by the e2e suite.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFile, mkdir } from 'node:fs/promises';

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
for (let p = 1; p <= 3; p++) {
  const page = doc.addPage([612, 792]);
  page.drawText(`Sample page ${p}`, { x: 72, y: 700, size: 28, font, color: rgb(0.1, 0.1, 0.1) });
  page.drawText('The quick brown fox jumps over the lazy dog.', { x: 72, y: 640, size: 16, font });
  page.drawText('Annotate me with highlights, ink and sticky notes.', { x: 72, y: 610, size: 16, font });
}
await mkdir(new URL('../e2e/fixtures/', import.meta.url), { recursive: true });
await writeFile(new URL('../e2e/fixtures/sample.pdf', import.meta.url), await doc.save());
console.log('fixtures written');
