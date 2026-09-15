import { Unzip, UnzipInflate } from "/vendor/fflate.js";
self.onmessage = ({ data: { bytes, extension } }) => {
  try {
    const selected = {},
      decoder = new TextDecoder();
    let total = 0,
      files = 0;
    const accept = (name) =>
      extension === "docx"
        ? /^word\/(document|header\d+|footer\d+)\.xml$/.test(name)
        : extension === "odt"
          ? name === "content.xml"
          : extension === "pptx"
            ? /^ppt\/slides\/slide\d+\.xml$/.test(name)
            : /^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/.test(name);
    const unzip = new Unzip((file) => {
      if (++files > 2000)
        throw Error(
          "This document contains too many parts. Export a smaller PDF or text file.",
        );
      if (!accept(file.name)) return;
      let text = "";
      file.ondata = (error, chunk, final) => {
        if (error) throw error;
        total += chunk.length;
        if (total > 4 * 1024 * 1024)
          throw Error(
            "The expanded document is too large. Export the relevant pages as PDF or text.",
          );
        text += decoder.decode(chunk, { stream: !final });
        if (final) selected[file.name] = text;
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    const input = new Uint8Array(bytes);
    for (let offset = 0; offset < input.length; offset += 4096)
      unzip.push(
        input.subarray(offset, offset + 4096),
        offset + 4096 >= input.length,
      );
    if (!Object.keys(selected).length)
      throw Error(
        "No readable document text found. Encrypted files must be unlocked first; legacy Office files should be exported as PDF.",
      );
    self.postMessage({ files: selected });
  } catch (error) {
    self.postMessage({
      error:
        error.message ||
        "Could not open this document. Export it as PDF or text.",
    });
  }
};
