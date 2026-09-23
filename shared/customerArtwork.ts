/** Customer choices are not staff approvals or automated quality certifications. */
export interface CustomerArtworkView {
  version: number;
  briefHash: string;
  savedBrief: string;
  generationEnabled: boolean;
  requestsRemaining: number;
  state: 'empty' | 'generating' | 'ready' | 'failed' | 'interrupted' | 'brief-changed';
  selectedId: string | null;
  selectedHash: string | null;
  appliedId: string | null;
  hasSavedPlan: boolean;
  canContinue: boolean;
  supportReference: string | null;
  candidates: Array<{ id: string; imageHash: string; assetUrl: string; operation: 'create' | 'edit'; correction: string | null }>;
}
