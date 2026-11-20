import { config } from './config';

export const GITHUB_REPO = 'letehaha/moneymatter';
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
export const ROADMAP_URL = 'https://moneymatter.featurebase.app/dashboard/roadmap';
export const REDDIT_URL = 'https://www.reddit.com/r/moneymatterapp/';
export const SUPPORT_EMAIL = 'support@moneymatter.app';

export interface GitHubActivityData {
  commitsLast30Days: number;
  lastUpdated: string;
  recentWeeksActivity: number[];
}

/** Null while GitHub is still computing the repo stats. */
export async function fetchGitHubActivity(): Promise<GitHubActivityData | null> {
  const response = await fetch(`${config.apiHttp}${config.apiVer}/github/activity`);

  if (!response.ok) {
    throw new Error(`GitHub activity fetch failed: ${response.status}`);
  }

  const json = await response.json();
  return json.response ?? null;
}
