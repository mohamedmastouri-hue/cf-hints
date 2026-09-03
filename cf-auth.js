/* Codeforces authenticated API signing (key + secret).
 * Per https://codeforces.com/apiHelp:
 *   apiSig = rand(6) + sha512Hex("rand/method?sortedParams#secret")
 * Secret is never sent over the wire; only the hash is.
 */
(function (global) {
  function randomRand() {
    const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let out = "";
    try {
      const buf = new Uint32Array(6);
      crypto.getRandomValues(buf);
      for (let i = 0; i < 6; i++) out += alphabet[buf[i] % alphabet.length];
      return out;
    } catch (e) {
      for (let i = 0; i < 6; i++) {
        out += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      return out;
    }
  }

  function toHex(bytes) {
    return Array.from(new Uint8Array(bytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async function sha512Hex(text) {
    if (!crypto?.subtle?.digest) throw new Error("WebCrypto unavailable; cannot sign CF request.");
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-512", data);
    return toHex(hash);
  }

  // params: plain object WITHOUT apiSig. Returns new object WITH apiKey/time/apiSig.
  async function signParams(method, params, key, secret, opts) {
    if (!key || !secret) throw new Error("Missing Codeforces API key/secret.");
    const time = (opts && opts.time) || Math.floor(Date.now() / 1000);
    const rand = (opts && opts.rand) || randomRand();
    const full = { ...params, apiKey: key, time: String(time) };
    const sorted = Object.keys(full)
      .sort()
      .map((k) => `${k}=${full[k]}`)
      .join("&");
    const hash = await sha512Hex(`${rand}/${method}?${sorted}#${secret}`);
    return { ...full, apiSig: `${rand}${hash}` };
  }

  async function signedUrl(apiBase, method, params, key, secret) {
    const signed = await signParams(method, params, key, secret);
    const qs = Object.keys(signed)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(signed[k])}`)
      .join("&");
    return `${apiBase}/${method}?${qs}`;
  }

  function hasAuth(auth) {
    return Boolean(auth && auth.key && auth.secret);
  }

  global.CfAuth = { signParams, signedUrl, hasAuth, randomRand, sha512Hex };
})(typeof window !== "undefined" ? window : globalThis);
