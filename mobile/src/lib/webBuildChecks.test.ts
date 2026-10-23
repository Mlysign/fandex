// The website build's checks (mobile/web/buildChecks.mjs): the CSP's script
// hashes, the shrink check against the last full build, and which commit the
// nightly run publishes.

import { describe, expect, it } from 'vitest';
import { baselineOf, contentSecurityPolicy, CSP_ENFORCED, inlineScripts, pickCommit, scriptHash, shrinkProblems } from '../../web/buildChecks.mjs';

describe('the CSP', () => {
  it('hashes a script the way a browser does: sha256 of the exact text, base64', () => {
    const js = '(function(){window.__fxpv=location.pathname})();';
    // From `printf %s "$js" | openssl dgst -sha256 -binary | base64`.
    expect(scriptHash(js)).toBe("'sha256-xX1GY5H+TOFN2DHjMxIGqKUS7LSzt3EORynMqRg9CG0='");
    // One character more is another hash: a changed script is a violation, not a pass.
    expect(scriptHash(`${js} `)).not.toBe(scriptHash(js));
  });

  it('finds the scripts a browser runs and skips files and data blocks', () => {
    const html = '<head><script type="application/ld+json">{"@type":"Movie"}</script><script src="/app-boot.js"></script></head>'
      + '<body><script>a()</script><script type="text/javascript">b()</script><script defer src="/x.js"></script></body>';
    expect(inlineScripts(html)).toEqual(['a()', 'b()']);
  });

  it('lists each hash once, and keeps the enforced part to what cannot break a page', () => {
    const policy = contentSecurityPolicy(["'sha256-b'", "'sha256-a'", "'sha256-b'"]);
    expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval' 'sha256-a' 'sha256-b';");
    expect(policy).toContain('frame-src https://www.youtube.com');
    // A browser ignores frame-ancestors in a report-only policy and logs that it did.
    expect(policy).not.toContain('frame-ancestors');
    expect(CSP_ENFORCED).toBe("frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  });
});

describe('the shrink check', () => {
  const last = { itemPages: 4561, facetPages: 4869, withRails: 4526, facetKinds: { tag: 2554, person: 1487, studio: 828 }, limited: false };

  it('passes a build like the last one, and one with no build before it', () => {
    expect(shrinkProblems(baselineOf(last), { facetPages: 4800, withRails: 4500, facetKinds: { tag: 2500, person: 1480, studio: 820 } })).toEqual([]);
    expect(shrinkProblems(baselineOf(null), { facetPages: 10, withRails: 0, facetKinds: { tag: 10 } })).toEqual([]);
  });

  it('refuses facet pages or rails below 90% of the last full build', () => {
    const problems = shrinkProblems(baselineOf(last), { facetPages: 4000, withRails: 2000, facetKinds: { tag: 2000, person: 1300, studio: 700 } });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('4000 facet pages, down from 4869');
    expect(problems[1]).toContain('2000 item pages with related rails, down from 4526');
  });

  it('refuses a kind of facet page that vanished, even when the total held', () => {
    expect(shrinkProblems(baselineOf(last), { facetPages: 4869, withRails: 4526, facetKinds: { tag: 3382, person: 1487 } }))
      .toEqual(['no studio pages, where the last full build had 828']);
  });

  it('refuses no facet pages at all, with or without a last build', () => {
    expect(shrinkProblems(null, { facetPages: 0, withRails: 0, facetKinds: {} })).toHaveLength(1);
  });

  it('holds a full build to the last FULL build, across a --limit try-out', () => {
    const tryout = { itemPages: 40, facetPages: 40, withRails: 30, limited: true, baseline: baselineOf(last) };
    expect(baselineOf(tryout)?.facetPages).toBe(4869);
    // A build.json from before these counts existed compares nothing it does not hold.
    expect(shrinkProblems(baselineOf({ itemPages: 4561, limited: false }), { facetPages: 5, withRails: 0, facetKinds: { tag: 5 } })).toEqual([]);
  });
});

describe('the nightly commit', () => {
  const main = ['c3', 'c2', 'c1'];
  const run = (headSha: string, conclusion: string, status = 'completed') => ({ headSha, conclusion, status });

  it('builds the newest commit when its CI passed', () => {
    expect(pickCommit(main, [run('c3', 'success'), run('c2', 'success')])).toEqual({ sha: 'c3' });
  });

  it('falls back to the newest green commit when the head is red, pending or unrun', () => {
    for (const runs of [[run('c3', 'failure'), run('c2', 'success')], [run('c3', '', 'in_progress'), run('c2', 'success')], [run('c2', 'success')]]) {
      const picked = pickCommit(main, runs);
      expect(picked.sha).toBe('c2');
      expect(picked.warning).toBeTruthy();
    }
  });

  it('goes by main\'s order, not by when a run happened', () => {
    // A re-run of an old commit is listed first; the newer green commit still wins.
    expect(pickCommit(main, [run('c3', 'failure'), run('c1', 'success'), run('c2', 'success')]).sha).toBe('c2');
  });

  it('builds the head with a warning when GitHub cannot be asked', () => {
    const picked = pickCommit(main, null);
    expect(picked.sha).toBe('c3');
    expect(picked.warning).toContain('could not be read');
  });

  it('refuses when GitHub answered and nothing recent passed', () => {
    const picked = pickCommit(main, [run('c3', 'failure'), run('c2', 'cancelled')]);
    expect(picked.sha).toBeNull();
    expect(picked.error).toBeTruthy();
  });
});
