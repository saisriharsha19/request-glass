export const documentExtensions = [
  "txt",
  "md",
  "csv",
  "tsv",
  "html",
  "htm",
  "rtf",
  "docx",
  "odt",
  "xlsx",
  "pptx",
];
const extensionOf = (name) => name.split(".").pop().toLowerCase();
function xml(source) {
  if (/<!DOCTYPE|<!ENTITY/i.test(source))
    throw Error(
      "Document declarations are not supported. Export a PDF or plain text copy.",
    );
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (doc.querySelector("parsererror"))
    throw Error(
      "This document contains damaged text. Export a new PDF or text copy.",
    );
  return doc;
}
function elements(node, name) {
  return [...node.getElementsByTagNameNS("*", name)];
}
function officeText(files, extension) {
  const keys = Object.keys(files).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  if (extension === "xlsx") {
    const strings = files["xl/sharedStrings.xml"]
      ? elements(xml(files["xl/sharedStrings.xml"]), "si").map((s) =>
          elements(s, "t")
            .map((t) => t.textContent)
            .join(""),
        )
      : [];
    return keys
      .filter((k) => k.includes("/worksheets/"))
      .map((key) => {
        const rows = elements(xml(files[key]), "row").map((row) =>
          elements(row, "c")
            .map((cell) => {
              const value = elements(cell, "v")[0]?.textContent || "";
              return cell.getAttribute("t") === "s"
                ? strings[Number(value)] || ""
                : cell.getAttribute("t") === "inlineStr"
                  ? elements(cell, "t")
                      .map((t) => t.textContent)
                      .join("")
                  : value;
            })
            .join("\t"),
        );
        return `[${key.split("/").pop()} — dates may be stored as spreadsheet serial numbers; review them manually]\n${rows.join("\n")}`;
      })
      .join("\n\n");
  }
  return keys
    .map((key) => {
      const doc = xml(files[key]);
      return elements(doc, "p")
        .map((p) =>
          extension === "odt"
            ? p.textContent
            : elements(p, "t")
                .map((t) => t.textContent)
                .join(""),
        )
        .join("\n");
    })
    .join("\n\n");
}
function rtfText(source) {
  if (!source.startsWith("{\\rtf"))
    throw Error("This is not a readable RTF document.");
  let out = "",
    stack = [],
    state = { skip: false, uc: 1 },
    fallback = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "{") {
      stack.push({ ...state });
      continue;
    }
    if (c === "}") {
      state = stack.pop() || state;
      continue;
    }
    if (c !== "\\") {
      if (fallback) fallback--;
      else if (!state.skip && c !== "\r" && c !== "\n") out += c;
      continue;
    }
    const tail = source.slice(i + 1);
    if (/^[\\{}]/.test(tail)) {
      if (!state.skip && !fallback) out += tail[0];
      else if (fallback) fallback--;
      i++;
      continue;
    }
    if (tail[0] === "*") {
      state.skip = true;
      i++;
      continue;
    }
    const hex = tail.match(/^'([0-9a-f]{2})/i);
    if (hex) {
      if (!state.skip && !fallback)
        out += new TextDecoder("windows-1252").decode(
          new Uint8Array([parseInt(hex[1], 16)]),
        );
      else if (fallback) fallback--;
      i += 3;
      continue;
    }
    const control = tail.match(/^([a-z]+)(-?\d+)? ?/i);
    if (!control) {
      i++;
      continue;
    }
    i += control[0].length;
    const [, word, arg] = control;
    if (
      [
        "fonttbl",
        "colortbl",
        "stylesheet",
        "info",
        "pict",
        "object",
        "fldinst",
      ].includes(word)
    )
      state.skip = true;
    if (word === "uc") state.uc = Math.max(0, Math.min(10, Number(arg)));
    if (state.skip) continue;
    if (word === "u") {
      out += String.fromCharCode((Number(arg) + 65536) % 65536);
      fallback = state.uc;
    }
    if (word === "par" || word === "line") out += "\n";
    if (word === "tab") out += "\t";
  }
  return out;
}
export async function readDocument(file, { signal } = {}) {
  const extension = extensionOf(file.name);
  if (!documentExtensions.includes(extension))
    throw Error(
      "Use PDF, PNG/JPG/WebP, TXT, Markdown, CSV/TSV, HTML, RTF, DOCX, ODT, XLSX or PPTX. Export legacy or other document formats as PDF.",
    );
  if (file.size > 10 * 1024 * 1024)
    throw Error("Choose a document under 10 MB.");
  signal?.throwIfAborted();
  let text;
  if (["docx", "odt", "xlsx", "pptx"].includes(extension)) {
    const bytes = await file.arrayBuffer();
    signal?.throwIfAborted();
    const files = await new Promise((resolve, reject) => {
      const worker = new Worker("/document-worker.js", { type: "module" });
      const done = (error, result) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        worker.terminate();
        error ? reject(error) : resolve(result);
      };
      const abort = () =>
        done(new DOMException("Document reading stopped", "AbortError"));
      const timer = setTimeout(
        () =>
          done(
            Error("Reading took too long. Export fewer pages as PDF or text."),
          ),
        15000,
      );
      signal?.addEventListener("abort", abort, { once: true });
      worker.onmessage = ({ data }) =>
        done(data.error ? Error(data.error) : null, data.files);
      worker.onerror = () =>
        done(
          Error("Could not open this document. Try a PDF or plain text copy."),
        );
      worker.postMessage({ bytes, extension }, [bytes]);
    });
    text = officeText(files, extension);
  } else {
    const bytes = new Uint8Array(await file.arrayBuffer());
    signal?.throwIfAborted();
    text = new TextDecoder(
      bytes[0] === 255 && bytes[1] === 254
        ? "utf-16le"
        : bytes[0] === 254 && bytes[1] === 255
          ? "utf-16be"
          : "utf-8",
    ).decode(bytes);
    if (text.includes("\0"))
      throw Error(
        "This file appears to be binary. Export a PDF or text version.",
      );
    if (["html", "htm"].includes(extension)) {
      const template = document.createElement("template");
      template.innerHTML = text;
      template.content
        .querySelectorAll("script,style,iframe,object,template,noscript")
        .forEach((n) => n.remove());
      template.content
        .querySelectorAll("p,div,br,tr,li,h1,h2,h3")
        .forEach((n) => n.append(document.createTextNode("\n")));
      text = template.content.textContent;
    }
    if (extension === "rtf") text = rtfText(text);
  }
  text = text.replace(/\r\n/g, "\n").trim();
  if (!text)
    throw Error(
      "No readable text found. For scanned documents, export a PDF and use local scanning.",
    );
  if (text.length > 50000)
    throw Error(
      "This document has more than 50,000 characters. Export the relevant section before importing.",
    );
  return { text, format: extension.toUpperCase() };
}
