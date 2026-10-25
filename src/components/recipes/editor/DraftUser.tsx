'use client';

import { createContext, useContext } from 'react';

const DraftUserContext = createContext<string | null>(null);

/** Rende disponibile l'id utente all'editor, per le chiavi delle bozze locali. */
export function DraftUserProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  return <DraftUserContext.Provider value={userId}>{children}</DraftUserContext.Provider>;
}

export function useDraftUser() {
  return useContext(DraftUserContext);
}
