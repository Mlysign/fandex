"use client";
import { useEffect, useState } from "react";
import type { MediaType } from "@/types";
import { sessionUser } from "@/lib/sessionProbe";
import { enabledMediaTypes } from "@/lib/mediaTypes";

// "Which media types does this account use Fandex for", for the four list
// surfaces that share the `rr_type_filter` chip row: Home, Discover, Calendar
// and MyStuff.
//
// Reads through `sessionUser()`, which shares probeSession's single cached
// /api/auth/me — so adding this to a page costs no extra request.
//
// ⚠️ Returns ALL types until the probe resolves, and that is deliberate. The
// alternative (start empty, fill in) would blank every list for a frame and
// then repopulate, which reads as a broken page; starting wide and narrowing
// only removes items that were never wanted. A signed-out visitor keeps all
// types forever, which is correct: the setting belongs to an account.
export function useEnabledTypes(): { enabled: MediaType[]; stored: string[] } {
  const [stored, setStored] = useState<string[]>([]);
  // Fetch-on-mount: the server cannot know the session for these client
  // islands. Same justified disable the other session-reading islands use.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void sessionUser().then((u) => setStored(u?.mediaTypes ?? [])); }, []);
  return { enabled: enabledMediaTypes(stored), stored };
}
