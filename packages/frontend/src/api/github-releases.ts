const LATEST_RELEASE_URL = 'https://api.github.com/repos/letehaha/moneymatter/releases/latest';

export interface LatestRelease {
  version: string;
  url: string;
}

export const getLatestRelease = async (): Promise<LatestRelease> => {
  const response = await fetch(LATEST_RELEASE_URL, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`GitHub latest release returned ${response.status}`);
  const { tag_name: tagName, html_url: url } = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
  if (typeof tagName !== 'string' || typeof url !== 'string' || !url.startsWith('https://github.com/'))
    throw new Error('GitHub latest release payload is malformed');
  return { version: tagName.replace(/^v/, ''), url };
};
