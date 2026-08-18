# Edit PDF

A PDF editor that runs entirely in the browser. Drop a PDF in, change it, download it.
Nothing is uploaded: no server, no account, no network call after the page loads.

Live: https://pdfeditor.kingdom.lv/

## Layout

```
index.html            landing page (marketing + SEO)
app/index.html        the editor
assets/css/theme.css  design tokens, light and dark, shared by both pages
assets/css/site.css   landing page styles
assets/css/app.css    editor styles
assets/js/theme.js    theme preference, shared by both pages
assets/js/site.js     landing page scroll chrome
assets/js/*.js        editor modules (store, viewer, text, exporter, util, app)
vendor/               pdf.js, pdf-lib, fontkit, DejaVu fonts
assets/img/og.jpg     social card, 1200x630 (JPEG: WhatsApp is unreliable with PNG)
sitemap.xml           the two indexable URLs
robots.txt            only takes effect on a custom domain, see the note inside
```

The editor modules resolve `vendor/` through `import.meta.url`, so they do not care where
the HTML that loads them lives.

## What it does

- **Edit the text that is already in the PDF.** Click any line on the page and retype it.
  The original line is covered with its own background colour (sampled from the page), and
  the replacement is drawn at the same baseline, size and ink colour.
- Add text boxes, freehand ink, highlights, rectangles, ellipses, arrows, white-out blocks
  and images or signatures.
- Page work: rotate, delete, drag to reorder, and drop a second PDF to append its pages.
- Undo/redo, zoom, per-page thumbnails.
- Auto-saves to IndexedDB, so a refresh or a closed tab does not lose the work.
- Downloads a real PDF: annotations are written as vector text and shapes with pdf-lib,
  not as a flattened image.

White-out and rectangles cover text, they do not remove it. The original text objects stay
in the file and a text extractor can still read them, so this is not redaction.

## Why it exists

Written by church members of LOGINGRUPA in Lielvārde, Latvia, part of Spirit and Truth
city church, alongside ClearWord (sound.kingdom.lv). It is free because what we were
given was free. The landing page says so under "Why we build", and both pages carry the
same statement as a comment at the top of `<body>`.

## Theming

`theme.css` carries both palettes in one place with `light-dark()`. `theme.js` runs
synchronously in `<head>`, resolves the stored choice (or the OS preference) and stamps
`data-theme="light|dark"` on `<html>` before the first paint, so CSS only needs a single
dark selector and there is no flash. Any element with `data-theme-toggle` flips it.

## Keyboard

| Key | Action |
| --- | --- |
| E | Edit page text |
| V | Select / move |
| T | Text box |
| P | Pen |
| H | Highlight |
| R | Rectangle |
| O | Ellipse |
| A | Arrow |
| W | White-out |
| I | Image |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Ctrl+S | Download |
| Ctrl+= / Ctrl+- | Zoom |
| Delete | Remove selection |

## How the text replacement works

PDF text is not editable in place: glyphs are drawn from embedded, often subset fonts with
private encodings. Rewriting a content stream in the browser would need the original font
programs re-encoded, which is not something a static page can do safely. So this editor
does what desktop tools do: it masks the original line and draws new text over it, using a
bundled Unicode font (DejaVu Sans, Serif and Mono, full Latin Extended plus Cyrillic and
Greek). The line breaking used on screen is the same code the exporter uses, so the preview
matches the downloaded file exactly.

## Running locally

Any static server works. There is no build step.

```
php -S 127.0.0.1:8080
```

Then open http://127.0.0.1:8080/. With Laragon, put the folder in `C:\laragon\www` and it
is served at http://edit-pdf.test/.

## Stack

- [pdf.js](https://mozilla.github.io/pdf.js/) for rendering and text extraction
- [pdf-lib](https://pdf-lib.js.org/) plus fontkit for writing the output PDF
- DejaVu fonts (Bitstream Vera licence)
- No framework, no bundler, no dependencies at runtime beyond the vendored files
