const MODEL = "mistral-small-latest";
const API_URL = "https://api.mistral.ai/v1/chat/completions";
const DEFAULT_API_KEY = "";
const SYSTEM_PROMPT =
  "You are a competitive programming coach. Given a problem, generate exactly 10 Socratic hints numbered 1 to 10. Each hint must guide the user's thinking without ever revealing the algorithm name, solution, or code. Start vague and progressively get more specific. Each hint is one sentence. Return only the 10 numbered hints as plain text, with no explanation, no markdown, and no code block.";

const titleElement = document.getElementById("title");
const hintTextElement = document.getElementById("hintText");
const counterElement = document.getElementById("counter");
const nextButton = document.getElementById("nextHint");
const regenerateLink = document.getElementById("regenerate");
const settingsElement = document.getElementById("settings");
const settingsToggle = document.getElementById("settingsToggle");
const apiKeyInput = document.getElementById("apiKey");
const cfApiKeyInput = document.getElementById("cfApiKey");
const cfApiSecretInput = document.getElementById("cfApiSecret");
const saveKeyButton = document.getElementById("saveKey");

let currentProblem = null;
let hints = [];
let currentHintIndex = 0;

document.addEventListener("DOMContentLoaded", init);
settingsToggle.addEventListener("click", toggleSettings);
saveKeyButton.addEventListener("click", saveApiKey);
nextButton.addEventListener("click", showNextHint);
regenerateLink.addEventListener("click", regenerateHints);

async function init() {
  setLoading("loading...");

  const activeUrl = await getActiveTabUrl();
  if (!isSupportedProblemUrl(activeUrl)) {
    showError("Open a Codeforces problem page.");
    return;
  }

  const data = await storageGet(["currentProblem", "title", "statement", "url", "apiKey", "cfApiKey", "cfApiSecret"]);
  const apiKey = data.apiKey || DEFAULT_API_KEY;
  const cfAuth = { key: (data.cfApiKey || "").trim(), secret: (data.cfApiSecret || "").trim() };
  currentProblem = data.currentProblem || {
    title: data.title,
    statement: data.statement,
    url: data.url
  };

  apiKeyInput.value = apiKey;
  if (cfApiKeyInput) cfApiKeyInput.value = cfAuth.key;
  if (cfApiSecretInput) cfApiSecretInput.value = cfAuth.secret;

  if (!currentProblem || !currentProblem.statement || !currentProblem.url) {
    showError("Open a Codeforces problem page first.");
    return;
  }

  titleElement.textContent = currentProblem.title || "Codeforces problem";

  // Enrich with official Codeforces API metadata (name/rating/tags).
  // Falls back to scraped title when offline; private/gym contests need CF key+secret.
  try {
    if (typeof CfApi !== "undefined") {
      const meta = await CfApi.resolveProblemMeta(currentProblem.url, cfAuth.key && cfAuth.secret ? cfAuth : null);
      if (meta && meta.name) {
        currentProblem.meta = meta;
        currentProblem.title = meta.name;
        titleElement.textContent = meta.name;
      }
    }
  } catch (e) {
    const msg = e && e.message ? e.message : "";
    if (/private|gym|forbidden|unauthorized|apiKey|apiSig/i.test(msg) && !(cfAuth.key && cfAuth.secret)) {
      // Keep statement flow; surface hint that CF credentials would help.
      titleElement.textContent = currentProblem.title || "Codeforces problem (private? add CF key)";
    }
    // Otherwise keep scraped title; API failure must not block hints.
  }

  const cacheKey = getCacheKey(currentProblem.url);
  const cached = await storageGet(cacheKey);
  const restored = normalizeCachedHints(cached[cacheKey]);
  if (restored) {
    loadHints(restored.hints, restored.index || 0, { persist: false });
    return;
  }

  if (!apiKey) {
    openSettings();
    showError("Add your API key in settings ↗");
    return;
  }

  await generateAndCacheHints(apiKey);
}

function toggleSettings() {
  settingsElement.classList.toggle("open");
  if (settingsElement.classList.contains("open")) {
    apiKeyInput.focus();
  }
}

function openSettings() {
  settingsElement.classList.add("open");
  apiKeyInput.focus();
}

async function saveApiKey() {
  const apiKey = apiKeyInput.value.trim();
  const cfApiKey = cfApiKeyInput ? cfApiKeyInput.value.trim() : "";
  const cfApiSecret = cfApiSecretInput ? cfApiSecretInput.value.trim() : "";
  if ((cfApiKey && !cfApiSecret) || (!cfApiKey && cfApiSecret)) {
    showError("Enter both CF API key and secret, or leave both empty.");
    return;
  }
  if (!apiKey && !cfApiKey) {
    showError("Enter an API key before saving.");
    return;
  }

  await storageSet({ apiKey, cfApiKey, cfApiSecret });

  if (currentProblem && hints.length === 0 && apiKey) {
    await generateAndCacheHints(apiKey);
  } else {
    hintTextElement.textContent = "Settings saved.";
  }
}

async function regenerateHints(event) {
  event.preventDefault();

  if (!currentProblem) {
    showError("Open a Codeforces problem page first.");
    return;
  }

  const data = await storageGet("apiKey");
  const apiKey = data.apiKey || DEFAULT_API_KEY;
  if (!apiKey) {
    openSettings();
    showError("Add your API key in settings ↗");
    return;
  }

  await chrome.storage.local.remove(getCacheKey(currentProblem.url));
  await generateAndCacheHints(apiKey);
}

async function generateAndCacheHints(apiKey) {
  try {
    setLoading("generating hints...");
    const generatedHints = await fetchHints(apiKey, currentProblem);
    await safeStorageSet({ [getCacheKey(currentProblem.url)]: { hints: generatedHints, index: 0, savedAt: Date.now() } });
    loadHints(generatedHints, 0);
  } catch (error) {
    showError(error.message || "Could not generate hints.");
  }
}

async function fetchHints(apiKey, problem, opts) {
  const attempts = (opts && opts.attempts) || 2;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.4,
          max_tokens: 2000,
          messages: [
            {
              role: "system",
              content: SYSTEM_PROMPT
            },
            {
              role: "user",
              content: buildPromptProblem(problem)
            }
          ]
        })
      });

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        const message = await readApiError(response);
        lastError = new Error(message);
        if (retryable && attempt < attempts) {
          await sleep(1000 * attempt);
          continue;
        }
        throw lastError;
      }

      const data = await response.json();
      const text = extractText(data);
      const parsed = parseHints(text);

      if (parsed.length !== 10) {
        throw new Error("API returned an invalid hint list.");
      }

      return parsed;
    } catch (error) {
      if (error && error.name === "AbortError") {
        lastError = new Error("Request timed out. Check connection and retry.");
        if (attempt < attempts) {
          await sleep(1000 * attempt);
          continue;
        }
        throw lastError;
      }
      if (attempt >= attempts) throw error;
      lastError = error;
      // Network TypeError is retryable; validation errors are not.
      if (error instanceof TypeError) {
        await sleep(1000 * attempt);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("Could not generate hints.");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readApiError(response) {
  const retryAfter = response.headers ? response.headers.get("Retry-After") : null;
  if (response.status === 429) {
    return retryAfter
      ? `Rate limited. Retry in ${retryAfter}s.`
      : "Rate limited. Wait a minute and retry.";
  }
  if (response.status === 401) return "Invalid Mistral API key. Check settings.";
  if (response.status >= 500) return `Mistral server error ${response.status}. Retrying may help.`;
  try {
    const data = await response.json();
    return data.error?.message || `API error ${response.status}`;
  } catch (error) {
    return `API error ${response.status}`;
  }
}

function extractText(data) {
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("API returned no text.");
  }

  return text.trim();
}

function parseHints(text) {
  return parseNumberedHints(text);
}

function parseNumberedHints(text) {
  const cleaned = String(text || "")
    .replace(/^```[\s\S]*?\n/, "")
    .replace(/```\s*$/, "")
    .trim();
  const hintsFromLines = cleaned
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:\d+[\).:-]\s*)/, "").trim())
    .filter(Boolean);

  if (hintsFromLines.length === 10) {
    return hintsFromLines;
  }

  const matches = [...cleaned.matchAll(/(?:^|\n)\s*\d+[\).:-]\s*([\s\S]*?)(?=\n\s*\d+[\).:-]\s*|$)/g)];
  const hintsFromMatches = matches.map((match) => match[1].trim()).filter(Boolean);

  if (hintsFromMatches.length === 10) {
    return hintsFromMatches;
  }

  throw new Error("API returned an invalid hint list.");
}

function loadHints(nextHints, startIndex, opts) {
  hints = nextHints;
  currentHintIndex = Math.min(Math.max(startIndex || 0, 0), hints.length - 1);
  renderCurrentHint();
  if (!opts || opts.persist !== false) persistHintIndex();
}

function showNextHint() {
  if (currentHintIndex < hints.length - 1) {
    currentHintIndex += 1;
    renderCurrentHint();
    persistHintIndex();
  }
}

function normalizeCachedHints(value) {
  if (Array.isArray(value) && value.length === 10) return { hints: value, index: 0 };
  if (value && Array.isArray(value.hints) && value.hints.length === 10) {
    const index = Math.min(Math.max(value.index || 0, 0), 9);
    return { hints: value.hints, index };
  }
  return null;
}

function persistHintIndex() {
  try {
    if (!currentProblem || !currentProblem.url) return;
    const key = getCacheKey(currentProblem.url);
    storageGet(key).then((cached) => {
      const entry = normalizeCachedHints(cached[key]);
      if (!entry) return;
      safeStorageSet({ [key]: { hints: entry.hints, index: currentHintIndex, savedAt: Date.now() } });
    }).catch(() => {});
  } catch (e) { /* ignore */ }
}

async function safeStorageSet(value) {
  try {
    await storageSet(value);
  } catch (e) {
    // Quota exceeded: drop CF metadata caches (re-fetchable) and retry once.
    try {
      const all = await storageGet(null);
      const removeKeys = Object.keys(all || {}).filter((k) => k.startsWith("cf:contest:") || k === "cf:problemset:v1");
      if (removeKeys.length) await chrome.storage.local.remove(removeKeys);
      await storageSet(value);
    } catch (retryError) {
      // Last resort: still show hints even if cache write fails.
    }
  }
}

function renderCurrentHint() {
  hintTextElement.textContent = hints[currentHintIndex] || "";
  counterElement.textContent = `Hint ${currentHintIndex + 1} / 10`;

  if (currentHintIndex >= hints.length - 1) {
    nextButton.textContent = "No more hints";
    nextButton.disabled = true;
  } else {
    nextButton.textContent = "Next hint →";
    nextButton.disabled = false;
  }
}

function setLoading(message) {
  hintTextElement.textContent = message;
  counterElement.textContent = "Hint 0 / 10";
  nextButton.textContent = "Next hint →";
  nextButton.disabled = true;
}

function showError(message) {
  hintTextElement.textContent = message;
  counterElement.textContent = "Hint 0 / 10";
  nextButton.textContent = "Next hint →";
  nextButton.disabled = true;
}

function getCacheKey(url) {
  try {
    if (typeof CfApi !== "undefined") return `hints:${CfApi.normalizeUrl(url)}`;
  } catch (e) { /* fall through */ }
  return `hints:${String(url || "").split("#")[0]}`;
}

async function getActiveTabUrl() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.url || "";
}

function isSupportedProblemUrl(url) {
  try {
    if (typeof CfApi !== "undefined") return CfApi.isSupportedProblemUrl(url);
  } catch (e) { /* fall through */ }
  return /^https:\/\/codeforces\.com\/problemset\/problem\//.test(url) ||
    /^https:\/\/codeforces\.com\/contest\/[^/]+\/problem\//.test(url);
}

function buildPromptProblem(problem) {
  const meta = problem.meta || {};
  const header = [problem.title || ""];
  if (meta.rating) header.push(`Rating: ${meta.rating}`);
  if (Array.isArray(meta.tags) && meta.tags.length) header.push(`Tags: ${meta.tags.join(", ")}`);
  if (meta.contestId && meta.index) header.push(`Problem: ${meta.contestId}${meta.index}`);
  const raw = typeof problem.statement === "string" ? problem.statement : "";
  const statement = raw.length > 12000 ? `${raw.slice(0, 12000).trim()}\n…[truncated]` : raw;
  return `${header.filter(Boolean).join("\n")}\n\n${statement}`;
}

function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

function storageSet(value) {
  return chrome.storage.local.set(value);
}
