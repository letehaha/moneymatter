import { GITHUB_REPO } from './github-api';

// ponytail: fetched at build time, so the count is as fresh as the last deploy.
// Move it to the cached /github/activity endpoint if that gets too stale.
let starsLabel: Promise<string | null> | undefined;

/** Compact star count ("135", "1.2K"), or null when GitHub is unreachable. One request per build. */
export function getGitHubStarsLabel(): Promise<string | null> {
  starsLabel ??= fetch(`https://api.github.com/repos/${GITHUB_REPO}`, {
    headers: process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {},
  })
    .then((res) => {
      if (res.ok) return res.json();
      console.warn(`GitHub stars request failed with status ${res.status}`);
      return null;
    })
    .then((repo) =>
      repo?.stargazers_count
        ? new Intl.NumberFormat('en', { notation: 'compact' }).format(repo.stargazers_count)
        : null,
    )
    .catch((error) => {
      console.warn('GitHub stars request failed:', error);
      return null;
    });
  return starsLabel;
}
