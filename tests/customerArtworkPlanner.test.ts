// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Event } from '@shared/schema';
const state = vi.hoisted(() => ({ event: {} as Event, completed: '[]', selected: null as string | null }));
vi.mock('../server/storage', () => ({ db: {}, storage: {
  getGeneration: async () => ({ completedStages: state.completed }), getEventById: async () => state.event, listGuests: async () => [],
  updateEventById: async (_id: number, data: Partial<Event>) => state.event = { ...state.event, ...data },
} }));
vi.mock('../server/customerArtworkPolicy', () => ({ keptCustomerArtwork: async () => state.selected }));
vi.mock('../server/masterPlannerEntitlement', () => ({ safeParseStages: (s: string) => JSON.parse(s), markGenerationConsumed: vi.fn(), markGenerationFailed: vi.fn(), markStageCompleted: vi.fn() }));
const { runMasterPlannerOrchestration } = await import('../server/masterPlannerOrchestrator');
beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'preview'); vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'codex/launch-blockers');
  vi.stubEnv('POSY_CUSTOMER_ARTWORK_FLOW', 'true'); vi.stubEnv('POSY_CUSTOMER_ARTWORK_EVENT_IDS', '99002');
  state.event = { id: 99002, eventName: 'Synthetic', eventType: 'Celebration', themeName: 'Kept garden', paletteColors: '["#ffffff"]',
    vibeDescription: 'Complete garden brief', inviteDesignConceptJson: '{"fontPairingId":"editorial-serif","aiFirst":{"approval":"old"}}' } as Event;
  state.completed = JSON.stringify(['theme', 'budget', 'menu', 'shopping', 'timeline', 'checks']); state.selected = null;
});
afterEach(() => vi.unstubAllEnvs());
it('reuses selected pixels, keeps saved styling and never labels the customer’s choice as model approval', async () => {
  state.selected = 'data:image/png;base64,c3ludGhldGlj'; const deps = { generateInviteConcepts: vi.fn(), generateIllustration: vi.fn() };
  await runMasterPlannerOrchestration(99002, 1, deps as any);
  expect(state.event.inviteArtworkUrl).toBe(state.selected); expect(state.event.inviteIllustrationUrl).toBe(state.selected);
  expect(JSON.parse(state.event.inviteDesignConceptJson)).toEqual({ fontPairingId: 'editorial-serif' });
  expect(deps.generateInviteConcepts).not.toHaveBeenCalled(); expect(deps.generateIllustration).not.toHaveBeenCalled();
});
it('does not generate replacement artwork if the choice cannot be verified', async () => {
  const deps = { generateInviteConcepts: vi.fn(), generateIllustration: vi.fn() };
  await expect(runMasterPlannerOrchestration(99002, 1, deps as any)).rejects.toThrow('Keep current artwork');
  expect(deps.generateIllustration).not.toHaveBeenCalled(); expect(state.event.draftStatus).toBe('failed_partial');
});
it('planning preserves the full selected theme and palette', async () => {
  state.completed = JSON.stringify(['budget', 'menu', 'shopping', 'timeline', 'invites', 'checks']);
  await runMasterPlannerOrchestration(99002, 1, { generateThemeAndIdentity: async () => ({ themeName: 'Wrong replacement', paletteColors: ['#000000'], eventIdentity: 'Plan identity' }) } as any);
  expect(state.event.themeName).toBe('Kept garden'); expect(state.event.paletteColors).toBe('["#ffffff"]');
});
