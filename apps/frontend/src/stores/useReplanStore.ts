// ═══════════════════════════════════════════════════════════
//  Replan Store — Minimal store for external refresh callback.
//  Legacy backend simulation/scenario logic removed (scheduling is client-side).
//  Only onApplyCallback is actively used by NikufraEngine.
// ═══════════════════════════════════════════════════════════

import { create } from 'zustand';

interface ReplanState {
  // Callback for external refresh (set by NikufraEngine)
  onApplyCallback: (() => void) | null;
}

const useReplanStore = create<ReplanState>(() => ({
  onApplyCallback: null,
}));

export default useReplanStore;
