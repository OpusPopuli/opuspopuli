"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@apollo/client/react";
import {
  GET_REGION_INFO,
  type CivicsBlock,
  type CivicsGlossaryEntry,
  type CivicsMeasureType,
} from "@/lib/graphql/region";

interface RegionInfoData {
  regionInfo: { civics?: CivicsBlock };
}

interface CivicsContextValue {
  civics: CivicsBlock | null;
  /** Slug → GlossaryEntry lookup map. O(1) per tooltip lookup. */
  glossaryMap: Map<string, CivicsGlossaryEntry>;
  /** Term (lowercase) → GlossaryEntry lookup map. */
  glossaryByTerm: Map<string, CivicsGlossaryEntry>;
  /** Measure type code (e.g. "AB") → MeasureType. For CivicTerm on externalIds. */
  measureTypeByCode: Map<string, CivicsMeasureType>;
  loading: boolean;
}

const CivicsContext = createContext<CivicsContextValue>({
  civics: null,
  glossaryMap: new Map(),
  glossaryByTerm: new Map(),
  measureTypeByCode: new Map(),
  loading: false,
});

export function CivicsProvider({ children }: { children: ReactNode }) {
  const { data, loading } = useQuery<RegionInfoData>(GET_REGION_INFO);
  const civics = data?.regionInfo?.civics ?? null;

  const glossaryMap = useMemo(() => {
    const map = new Map<string, CivicsGlossaryEntry>();
    if (civics) for (const entry of civics.glossary) map.set(entry.slug, entry);
    return map;
  }, [civics]);

  const glossaryByTerm = useMemo(() => {
    const map = new Map<string, CivicsGlossaryEntry>();
    if (civics)
      for (const entry of civics.glossary)
        map.set(entry.term.toLowerCase(), entry);
    return map;
  }, [civics]);

  const measureTypeByCode = useMemo(() => {
    const map = new Map<string, CivicsMeasureType>();
    if (civics) for (const mt of civics.measureTypes) map.set(mt.code, mt);
    return map;
  }, [civics]);

  const value = useMemo(
    () => ({ civics, glossaryMap, glossaryByTerm, measureTypeByCode, loading }),
    [civics, glossaryMap, glossaryByTerm, measureTypeByCode, loading],
  );

  return (
    <CivicsContext.Provider value={value}>{children}</CivicsContext.Provider>
  );
}

export function useCivics() {
  return useContext(CivicsContext);
}
