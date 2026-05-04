import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const owner =
  process.env.ORG ||
  process.env.GITHUB_REPOSITORY_OWNER ||
  "Forjd";
const readmePath = process.env.README_PATH || "profile/README.md";
const token = process.env.GITHUB_TOKEN;

const startMarker = "<!-- repos:start -->";
const endMarker = "<!-- repos:end -->";

async function githubFetch(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}\n${body}`);
  }

  return response;
}

function nextPage(linkHeader) {
  if (!linkHeader) return null;

  const nextLink = linkHeader
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.endsWith('rel="next"'));

  return nextLink?.match(/<([^>]+)>/)?.[1] ?? null;
}

async function getPublicRepos() {
  const repos = [];
  let url = `https://api.github.com/orgs/${encodeURIComponent(owner)}/repos?type=public&per_page=100&sort=pushed&direction=desc`;

  while (url) {
    const response = await githubFetch(url);
    repos.push(...(await response.json()));
    url = nextPage(response.headers.get("link"));
  }

  return repos.sort((a, b) => {
    const latestA = new Date(a.pushed_at || a.updated_at).getTime();
    const latestB = new Date(b.pushed_at || b.updated_at).getTime();

    return latestB - latestA || a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  });
}

function escapeCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .trim();
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function repoDescription(repo) {
  const description = repo.description || "No description provided.";
  return repo.archived ? `${description} _(archived)_` : description;
}

function renderRepos(repos) {
  if (repos.length === 0) {
    return `No public repositories found for ${owner}.`;
  }

  const rows = repos.map((repo) => {
    const name = `[${escapeCell(repo.name)}](${repo.html_url})`;
    const description = escapeCell(repoDescription(repo));
    const language = escapeCell(repo.language || "n/a");
    const stars = repo.stargazers_count.toLocaleString("en-GB");
    const updated = formatDate(repo.pushed_at || repo.updated_at);

    return `| ${name} | ${description} | ${language} | ${stars} | ${updated} |`;
  });

  return [
    `_Public repositories in the ${owner} GitHub organisation. Updated automatically._`,
    "",
    "| Repository | Description | Language | Stars | Updated |",
    "| --- | --- | --- | ---: | --- |",
    ...rows,
  ].join("\n");
}

function replaceGeneratedBlock(readme, content) {
  const start = readme.indexOf(startMarker);
  const end = readme.indexOf(endMarker);

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Could not find ${startMarker} and ${endMarker} in ${readmePath}`);
  }

  return [
    readme.slice(0, start + startMarker.length),
    "\n",
    content,
    "\n",
    readme.slice(end),
  ].join("");
}

const repos = await getPublicRepos();
const readme = await readFile(readmePath, "utf8");
const nextReadme = replaceGeneratedBlock(readme, renderRepos(repos));

await writeFile(readmePath, nextReadme);
