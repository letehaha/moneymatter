import { describe, expect, it } from '@jest/globals';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

const PUBLIC_DIR = path.resolve(__dirname, '../../../../frontend/public');
const INDEX_PATH = path.join(PUBLIC_DIR, '.well-known/agent-skills/index.json');
const SITE_ORIGIN = 'https://moneymatter.app';

interface SkillsIndex {
  skills: Array<{
    name: string;
    type: string;
    description: string;
    url: string;
    sha256: string;
  }>;
}

function readIndex(): SkillsIndex {
  return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
}

function resolveLocalPath(url: string): string {
  if (!url.startsWith(`${SITE_ORIGIN}/`)) {
    throw new Error(`Skill url must be rooted at ${SITE_ORIGIN}: got ${url}`);
  }
  const relative = url.slice(SITE_ORIGIN.length + 1);
  return path.join(PUBLIC_DIR, relative);
}

describe('agent-skills drift', () => {
  it('every skill URL resolves to a real file in the frontend public dir', () => {
    for (const skill of readIndex().skills) {
      const filePath = resolveLocalPath(skill.url);
      expect(fs.existsSync(filePath)).toBe(true);
    }
  });

  it('every skill sha256 matches the actual file digest', () => {
    for (const skill of readIndex().skills) {
      const filePath = resolveLocalPath(skill.url);
      const digest = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

      expect(digest).toBe(skill.sha256);
    }
  });

  it('no served skill contains merge-conflict markers', () => {
    const conflictMarker = /^(<<<<<<<|=======|>>>>>>>|> > > > > > >)/;

    for (const skill of readIndex().skills) {
      const lines = fs.readFileSync(resolveLocalPath(skill.url), 'utf-8').split('\n');

      expect(lines.filter((line) => conflictMarker.test(line))).toEqual([]);
    }
  });

  it('skill names are unique', () => {
    const names = readIndex().skills.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
