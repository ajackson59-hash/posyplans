/** Display intent only; selection and payment are verified separately on the server. */
export const CUSTOMER_ARTWORK_RENDER_MODE = 'customer-artwork';
export function hasAppliedCustomerArtwork(event: { inviteRenderMode?: string; inviteArtworkUrl?: string }) {
  return event.inviteRenderMode === CUSTOMER_ARTWORK_RENDER_MODE && !!event.inviteArtworkUrl;
}

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
  uploadAvailable?: boolean;
  uploadsRemaining?: number;
  candidates: Array<{ id: string; imageHash: string; assetUrl: string; operation: 'create' | 'edit' | 'upload' | 'template'; correction: string | null }>;
}
