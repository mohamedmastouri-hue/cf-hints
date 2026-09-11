# CF Hints

A Chrome extension that generates Socratic hints for Codeforces problems.

Problem identity (name, rating, tags) comes from the official Codeforces API.
The statement body is read from the page and sent to Mistral with rating/tags
for better hints. No full-page scraping: title scraping was removed.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select this folder.

## Keys (stored locally in `chrome.storage.local`)

- **Mistral API key** (required for hints): popup gear -> `Mistral API key` -> Save.
- **Codeforces API key + secret** (optional, only for private/gym contests):
  1. Create at `https://codeforces.com/settings/api`.
  2. Popup gear -> fill `Codeforces API key` + `Codeforces API secret` -> Save.
  3. Public problemset/contest works anonymously without these.

## Supported Pages

- `https://codeforces.com/problemset/problem/*` (via `problemset.problems`)
- `https://codeforces.com/contest/*/problem/*` (via `contest.standings` public mode)

## Notes / Limits

- Codeforces API has no statement text, so the extension reads only the
  statement sections (Limits / Legend / Input / Output / Samples / Note,
  max ~12k chars) from the page. Metadata caching is 1h.
- Hint cache is per normalized problem URL (`{hints, index}`); progress
  persists across popup closes. Regenerate clears it.
- Merge order for the improvement stack: #1 -> #2 -> #3 -> #4 -> #5 -> #6.
