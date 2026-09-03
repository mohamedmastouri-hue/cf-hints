/* Structured statement extractor (replaces full-page blob scrape).
 * Title comes from the Codeforces API (cf-api.js); this script only reads
 * the statement body sections so the LLM prompt stays clean and small.
 */
(function () {
  const MAX_SECTION_CHARS = 6000;
  const MAX_STATEMENT_CHARS = 12000;

  function getText(element) {
    if (!element) return "";
    const t = element.innerText || element.textContent || "";
    return t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function truncate(text, max) {
    if (!text || text.length <= max) return text || "";
    return `${text.slice(0, max).trim()}\n…[truncated]`;
  }

  function sectionText(root, selector) {
    const el = root ? root.querySelector(selector) : null;
    return truncate(getText(el), MAX_SECTION_CHARS);
  }

  function extractSamples(root) {
    const blocks = root ? root.querySelectorAll(".sample-test") : [];
    const samples = [];
    blocks.forEach((block, i) => {
      const input = getText(block.querySelector(".input pre")) || getText(block.querySelector(".input"));
      const output = getText(block.querySelector(".output pre")) || getText(block.querySelector(".output"));
      if (!input && !output) return;
      samples.push(
        `Sample ${i + 1} Input:\n${truncate(input, 2000)}\nSample ${i + 1} Output:\n${truncate(output, 2000)}`
      );
    });
    // Older CF markup uses a single .sample-tests pre pair
    if (!samples.length && root) {
      const single = root.querySelector(".sample-tests");
      const text = getText(single);
      if (text) samples.push(truncate(text, 4000));
    }
    return samples.slice(0, 4).join("\n\n");
  }

  function extractLegend(root) {
    if (!root) return "";
    // Preferred: paragraphs before .input-specification
    const inputSpec = root.querySelector(".input-specification");
    if (inputSpec) {
      let node = root.firstElementChild;
      const parts = [];
      while (node && node !== inputSpec) {
        if (node.matches && !node.matches(".header,.time-limit,.memory-limit,.input-file,.output-file")) {
          const t = getText(node);
          if (t) parts.push(t);
        }
        node = node.nextElementSibling;
      }
      const legend = parts.join("\n\n").trim();
      if (legend) return truncate(legend, MAX_SECTION_CHARS);
    }
    // Fallback: whole statement minus known sections is too noisy; use first div text
    const firstDiv = root.querySelector("div:not([class])");
    return truncate(getText(firstDiv), MAX_SECTION_CHARS);
  }

  function scrapeProblem() {
    const root = document.querySelector(".problem-statement");
    if (!root) return;
    const url = window.location.href.split("#")[0];

    const timeLimit = sectionText(root, ".time-limit");
    const memoryLimit = sectionText(root, ".memory-limit");
    const limits = [timeLimit, memoryLimit].filter(Boolean).join("\n");
    const legend = extractLegend(root);
    const input = sectionText(root, ".input-specification");
    const output = sectionText(root, ".output-specification");
    const samples = extractSamples(root);
    const note = sectionText(root, ".note");

    const sections = { limits, legend, input, output, samples, note };
    const flat = [
      limits && `Limits:\n${limits}`,
      legend && `Legend:\n${legend}`,
      input && `Input:\n${input}`,
      output && `Output:\n${output}`,
      samples && `Samples:\n${samples}`,
      note && `Note:\n${note}`
    ]
      .filter(Boolean)
      .join("\n\n");

    const statement = truncate(flat || getText(root), MAX_STATEMENT_CHARS);
    if (!statement) return;

    // Reference for API lookup (contestId/index from URL, no title scraping)
    let ref = null;
    try {
      const m =
        url.match(/codeforces\.com\/problemset\/problem\/(\d+)\/([A-Za-z0-9]+)/) ||
        url.match(/codeforces\.com\/contest\/(\d+)\/problem\/([A-Za-z0-9]+)/);
      if (m) ref = { contestId: Number(m[1]), index: m[2].toUpperCase() };
    } catch (e) { /* ignore */ }

    const record = { url, statement, sections, ref, title: "" };
    try {
      const p = chrome.storage.local.set({
        url,
        statement,
        title: "",
        currentProblem: record
      });
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (e) { /* ignore */ }
  }

  scrapeProblem();
})();
