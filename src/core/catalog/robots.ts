// robots.txt (RFC 9309): the importer reads a supplier's pages only where the
// site allows it.

export type Robots = {
  rules: { allow: boolean; pattern: string }[];
  /** Seconds between requests, when the site asks for one. */
  crawlDelay?: number;
};

export const ALLOW_ALL: Robots = { rules: [] };

/** The rules of the group for our product token, or of the * group. */
export function parseRobots(text: string, productToken: string): Robots {
  type Group = { agents: string[]; rules: Robots['rules']; delay?: number };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.slice(0, 500_000).split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') {
      // An empty Disallow allows everything; it adds no rule.
      if (value) current.rules.push({ allow: key === 'allow', pattern: value });
    } else if (key === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.delay = n;
    }
  }
  const token = productToken.toLowerCase();
  const mine = groups.filter((g) =>
    g.agents.some((a) => a !== '*' && token.startsWith(a)),
  );
  const chosen = mine.length
    ? mine
    : groups.filter((g) => g.agents.includes('*'));
  const delays = chosen.map((g) => g.delay).filter((d) => d !== undefined);
  return {
    rules: chosen.flatMap((g) => g.rules),
    crawlDelay: delays.length ? Math.max(...delays) : undefined,
  };
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp(
    '^' +
      body
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*') +
      (anchored ? '$' : ''),
  );
  return re.test(path);
}

/** Longest matching rule wins; Allow wins a tie. */
export function isAllowed(robots: Robots, pathAndQuery: string): boolean {
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of robots.rules) {
    if (!matches(rule.pattern, pathAndQuery)) continue;
    const length = rule.pattern.length;
    if (
      !best ||
      length > best.length ||
      (length === best.length && rule.allow && !best.allow)
    )
      best = { allow: rule.allow, length };
  }
  return best ? best.allow : true;
}
