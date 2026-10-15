// Home's "Popular people": the ranked pool the website's build writes to
// /catalog/people.json (mobile/web/render.tsx, popularPeople), today's rail
// rotated out of it as the site's was (src/lib/homeSnapshot.ts, 20 faces).
//
// From the build because it holds every title's cast with its portrait. The
// device holds neither portraits nor casts, and asking TMDB for each face on
// the most-opened screen is the cost the old site was written to avoid.
// An app pointed at another API has no such file (CATALOG_FILES_URL is null)
// and shows no rail.

import { useEffect, useState } from 'react';
import { dayISO, rotateRail, seedFor } from '@/lib/dailyRotation';
import type { PopularPerson } from '~/components/PersonCard';
import { CATALOG_FILES_URL } from '~/lib/config';

export const PEOPLE_RAIL_SIZE = 20;

let pool: Promise<PopularPerson[]> | null = null;

function loadPool(): Promise<PopularPerson[]> {
  if (CATALOG_FILES_URL === null) return Promise.resolve([]);
  pool ??= fetch(`${CATALOG_FILES_URL}/catalog/people.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { people?: PopularPerson[] } | null) => (Array.isArray(d?.people) ? d.people : []))
    // No rail is the answer to a missing file. Asked again on the next start.
    .catch(() => { pool = null; return []; });
  return pool;
}

export function usePopularPeople(): PopularPerson[] {
  const [people, setPeople] = useState<PopularPerson[]>([]);
  useEffect(() => {
    let live = true;
    void loadPool().then((all) => { if (live) setPeople(rotateRail(all, PEOPLE_RAIL_SIZE, seedFor('people', dayISO()))); });
    return () => { live = false; };
  }, []);
  return people;
}
