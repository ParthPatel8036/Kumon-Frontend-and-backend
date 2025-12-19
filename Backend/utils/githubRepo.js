// utils/githubRepo.js
// Upload, fetch, and delete files in a GitHub repo using the Contents API.

const {
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH = "main",
} = process.env;

function assertEnv() {
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    throw new Error("Missing GitHub config: set GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO (and optionally GITHUB_BRANCH).");
  }
}

const BASE = () =>
  `https://api.github.com/repos/${encodeURIComponent(GITHUB_OWNER)}/${encodeURIComponent(GITHUB_REPO)}/contents`;

async function ghFetch(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "User-Agent": "kumon-qr-uploader",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status} ${res.statusText}: ${text}`);
  }
  return res;
}

/** Get file (returns { content(base64), sha } or null if 404) */
export async function repoGet(path) {
  assertEnv();
  const u = `${BASE()}/${encodeURIComponent(path)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
  const res = await fetch(u, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "User-Agent": "kumon-qr-uploader",
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`GitHub GET failed: ${res.status} ${t}`);
  }
  const json = await res.json();
  return { content: json.content, sha: json.sha, size: json.size, path: json.path };
}

/** Create or update file (returns { sha }) */
export async function repoPut(path, bufferOrBase64, message) {
  assertEnv();
  const existing = await repoGet(path).catch(() => null);
  const contentBase64 =
    Buffer.isBuffer(bufferOrBase64)
      ? bufferOrBase64.toString("base64")
      : String(bufferOrBase64);

  const body = {
    message: message || `Update ${path}`,
    branch: GITHUB_BRANCH,
    content: contentBase64,
    ...(existing?.sha ? { sha: existing.sha } : {}),
  };

  const u = `${BASE()}/${encodeURIComponent(path)}`;
  const res = await ghFetch(u, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { sha: json.content?.sha || json.sha };
}

/** Delete file (no-op if missing) */
export async function repoDelete(path, message = `Delete ${path}`) {
  assertEnv();
  const existing = await repoGet(path);
  if (!existing?.sha) return { deleted: false, reason: "not_found" };
  const u = `${BASE()}/${encodeURIComponent(path)}`;
  await ghFetch(u, {
    method: "DELETE",
    body: JSON.stringify({ message, branch: GITHUB_BRANCH, sha: existing.sha }),
  });
  return { deleted: true };
}