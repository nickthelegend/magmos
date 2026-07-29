"use client";

import { useState } from "react";

/**
 * Editable state whose initial value comes from data that arrives later.
 *
 * The obvious version of this is `useEffect(() => setName(org.name), [org.name])`, which appears in
 * a lot of settings forms — and is wrong twice over: it costs an extra render pass every time the
 * data resolves, and because most queries refetch on an interval it can overwrite what the user is
 * currently typing.
 *
 * This is React's documented "adjusting state when a prop changes" pattern instead: compare against
 * the previous seed *during render* and only reset when the seed itself actually changed. Typing is
 * never clobbered by a refetch that returned the same value.
 *
 * ```ts
 * const [name, setName] = useSeededState(org?.name ?? "");
 * ```
 */
export function useSeededState<T>(seed: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(seed);
  const [prevSeed, setPrevSeed] = useState<T>(seed);

  if (!Object.is(prevSeed, seed)) {
    setPrevSeed(seed);
    setValue(seed);
  }

  return [value, setValue];
}
