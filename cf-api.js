/* CF API resolver: replaces title scraping with official metadata.
 * Docs: https://codeforces.com/apiHelp
 * - problemset/problem/CONTEST_ID/INDEX -> problemset.problems (anonymous)
 * - contest/CONTEST_ID/problem/INDEX   -> contest.standings?contestId=X (public mode, anonymous)
 * NOTE: CF API has no statement text (name/rating/tags only).
 */
(function (global) {
  const API_BASE = "https://codeforces.com/api";
  const PROBLEMSET_TTL_MS = 60 * 60 * 1000; // 1h
  const CONTEST_TTL_MS = 60 * 60 * 1000; // 1h

  function normalizeUrl(url) {
    if (!url) return "";
    try {
      const u = new URL(url);
      u.hash = "";
      // drop tracking / locale params CF sometimes adds, keep path intact
      u.searchParams.delete("locale");
      // remove trailing slash (except root)
      let out = u.origin + u.pathname.replace(/\/+$/, "") + (u.search ? u.search : "");
      // u.search above still contains other params; rebuild cleanly
      const params = new URLSearchParams(u.search);
      params.delete("locale");
      const qs = params.toString();
      out = u.origin + u.pathname.replace(/\/+$/, "") + (qs ? `?${qs}` : "");
      return out;
    } catch (e) {
      return String(url).split("#")[0].replace(/\/+$/, "");
    }
  }

  function parseProblemRef(url) {
    if (!url) return null;
    let m = String(url).match(/codeforces\.com\/problemset\/problem\/(\d+)\/([A-Za-z0-9]+)/);
    if (m) return { kind: "problemset", contestId: Number(m[1]), index: m[2].toUpperCase() };
    m = String(url).match(/codeforces\.com\/contest\/(\d+)\/problem\/([A-Za-z0-9]+)/);
    if (m) return { kind: "contest", contestId: Number(m[1]), index: m[2].toUpperCase() };
    return null;
  }

  function isSupportedProblemUrl(url) {
    return parseProblemRef(url) !== null;
  }

  async function readApiResponse(response) {
    let data = null;
    try {
      data = await response.json();
    } catch (e) {
      throw new Error(`Codeforces API error ${response.status}`);
    }
    if (!response.ok || data.status !== "OK") {
      throw new Error(data?.comment || `Codeforces API error ${response.status}`);
    }
    return data.result;
  }

  function storageGet(keys) {
    try {
      return chrome.storage.local.get(keys);
    } catch (e) {
      return Promise.resolve({});
    }
  }

  function storageSet(value) {
    try {
      return chrome.storage.local.set(value);
    } catch (e) {
      return Promise.resolve();
    }
  }

  async function fetchProblemsetMeta(contestId, index) {
    const cacheKey = "cf:problemset:v1";
    const now = Date.now();
    const cached = await storageGet(cacheKey);
    let entry = cached[cacheKey];
    if (!entry || now - entry.time > PROBLEMSET_TTL_MS || !Array.isArray(entry.problems)) {
      const res = await fetch(`${API_BASE}/problemset.problems`);
      const result = await readApiResponse(res);
      entry = { time: now, problems: result.problems || [] };
      // best-effort cache; ignore quota errors
      try {
        await storageSet({ [cacheKey]: entry });
      } catch (e) { /* ignore */ }
    }
    const found = (entry.problems || []).find(
      (p) => p.contestId === contestId && String(p.index).toUpperCase() === String(index).toUpperCase()
    );
    if (!found) throw new Error("Problem not found in Codeforces problemset.");
    return {
      contestId: found.contestId,
      index: found.index,
      name: found.name,
      rating: found.rating || null,
      tags: found.tags || [],
      type: found.type || null,
      source: "problemset.problems"
    };
  }

  async function contestStandingsUrl(contestId, auth) {
    // Public mode must use exactly one query param and no auth.
    if (auth && auth.key && auth.secret && typeof CfAuth !== "undefined") {
      try {
        return await CfAuth.signedUrl(API_BASE, "contest.standings", { contestId: String(contestId) }, auth.key, auth.secret);
      } catch (e) {
        // Fall through to anonymous below; caller surfaces auth errors separately.
      }
    }
    return `${API_BASE}/contest.standings?contestId=${encodeURIComponent(contestId)}`;
  }

  async function fetchContestMeta(contestId, index, auth) {
    const authed = Boolean(auth && auth.key && auth.secret);
    const cacheKey = authed ? `cf:contest:${contestId}:auth:v1` : `cf:contest:${contestId}:v1`;
    const now = Date.now();
    const cached = await storageGet(cacheKey);
    let entry = cached[cacheKey];
    if (!entry || now - entry.time > CONTEST_TTL_MS || !Array.isArray(entry.problems)) {
      const url = await contestStandingsUrl(contestId, auth);
      const res = await fetch(url);
      const result = await readApiResponse(res);
      entry = { time: now, problems: result.problems || [] };
      try {
        await storageSet({ [cacheKey]: entry });
      } catch (e) { /* ignore */ }
    }
    const found = (entry.problems || []).find(
      (p) => String(p.index).toUpperCase() === String(index).toUpperCase()
    );
    if (!found) throw new Error("Problem not found in contest standings.");
    return {
      contestId,
      index: found.index,
      name: found.name,
      rating: found.rating || null,
      tags: found.tags || [],
      type: found.type || null,
      source: "contest.standings"
    };
  }

  async function resolveProblemMeta(url, auth) {
    const ref = parseProblemRef(url);
    if (!ref) throw new Error("Open a Codeforces problem page.");
    if (ref.kind === "problemset") return fetchProblemsetMeta(ref.contestId, ref.index);
    return fetchContestMeta(ref.contestId, ref.index, auth);
  }

  global.CfApi = {
    API_BASE,
    normalizeUrl,
    parseProblemRef,
    isSupportedProblemUrl,
    resolveProblemMeta,
    fetchProblemsetMeta,
    fetchContestMeta
  };
})(typeof window !== "undefined" ? window : globalThis);
