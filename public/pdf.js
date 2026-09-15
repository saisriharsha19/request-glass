import {findLinks} from './links.js';
// Loaded on demand. Original PDFs never enter browser storage or a network request.
export async function readPdf(file, { signal, onProgress, recognize }) {
  const pdfjs = await import("/pdf/pdf.min.mjs");
  if (signal.aborted) throw new DOMException("Stopped", "AbortError");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf/pdf.worker.min.mjs";
  const loading = pdfjs.getDocument({
    data: await file.arrayBuffer(),
    isEvalSupported: false,
    useWasm: false,
    cMapUrl: "/pdf/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdf/fonts/",
  });
  const stop = () => {
    loading.destroy().catch(() => {});
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    const doc = await loading.promise;
    if (doc.numPages > 10)
      throw new Error("Choose a receipt PDF with 10 pages or fewer.");
    const pages = [],
      images = [];
    let scanned = 0;
    for (let number = 1; number <= doc.numPages; number++) {
      if (signal.aborted) throw new DOMException("Stopped", "AbortError");
      onProgress(
        `Reading PDF page ${number} of ${doc.numPages}…`,
        ((number - 1) / doc.numPages) * 100,
      );
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      let text = "",
        lastY = null;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const y = item.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 3 && !text.endsWith("\n"))
          text += "\n";
        text += item.str + (item.hasEOL ? "\n" : " ");
        lastY = y;
      }
      const readable=text.replace(/[^\p{L}\p{N}]/gu,'').length;
      const needsOcr = readable < 40 || (text.match(/\uFFFD/g)||[]).length > text.length * .02;
      {
        onProgress(
          `Preparing PDF page ${number} of ${doc.numPages} on your device…`,
          ((number - 1) / doc.numPages) * 100,
        );
        const initial = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: Math.min(2.5, 1800 / Math.max(initial.width, initial.height)),
        });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const task = page.render({
          canvas,
          canvasContext: canvas.getContext("2d"),
          viewport,
        });
        const cancelRender = () => task.cancel();
        signal.addEventListener("abort", cancelRender, { once: true });
        try {
          await task.promise;
        } finally {
          signal.removeEventListener("abort", cancelRender);
        }
        if (signal.aborted) throw new DOMException("Stopped", "AbortError");
        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        images.push(canvas.toDataURL("image/jpeg", 0.7));
        if (needsOcr) {
          const recognized = await recognize(blob);
          if(recognized.trim())text=recognized;
          scanned++;
        }
        canvas.width = 0;
        canvas.height = 0;
      }
      const annotations=await page.getAnnotations({intent:'display'});
      const links=findLinks(annotations.map(a=>a.url || '').join(' '));
      pages.push(`PAGE ${number}\n${text.trim()}${links.length?'\nDocument links: '+links.join('\n'):''}`);
      page.cleanup();
      if (pages.join("\n\n").length > 50000)
        throw new Error(
          "This PDF contains too much text. Use a shorter receipt (up to 50,000 characters).",
        );
      // Yield between pages so controls and scrolling remain available.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (!pages.some((p) => p.replace(/^PAGE \d+\s*/,'').trim()))
      throw new Error(
        "No readable text found. Try a clearer PDF or enter the details manually.",
      );
    return { text: pages.join("\n\n"), pages: doc.numPages, scanned, images };
  } catch (error) {
    if (signal.aborted) throw new DOMException("Stopped", "AbortError");
    if (error.name === "PasswordException")
      throw new Error(
        "This PDF is password protected. Upload an unlocked copy.",
      );
    throw error;
  } finally {
    signal.removeEventListener("abort", stop);
    await loading.destroy().catch(() => {});
  }
}
