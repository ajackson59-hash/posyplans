// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ active: true, stages: ['theme', 'budget', 'menu', 'shopping', 'timeline', 'checks'], startupError: false }));
const assertActive = vi.hoisted(() => vi.fn(async () => { if (!state.active) throw new Error('Claim lost'); }));
const persist = vi.hoisted(() => vi.fn(async () => { if (!state.active) throw new Error('Claim lost'); }));
const fail = vi.hoisted(() => vi.fn(async () => { if (!state.active) throw new Error('Claim lost'); }));
vi.mock('../server/masterPlannerRunStore', () => ({ MasterPlannerRunStore: class {
  assertActive = assertActive; setStage = assertActive; completeStage = persist; fail = fail; finish = assertActive;
} }));
vi.mock('../server/storage', () => ({ storage: {
  getGeneration: async () => ({ completedStages: JSON.stringify(state.stages) }),
  getEventById: async () => { if (state.startupError) throw new Error('Offline read failure'); return {
    id: 990010, eventName: 'Offline party', eventType: 'Birthday Party', themeName: 'Garden',
    estimatedGuestCount: 12, vibeDescription: 'Watercolor garden', inviteDesignConceptJson: '{}',
  }; },
  listGuests: async () => [], listMenuItems: async () => [], listBudgetItems: async () => [],
} }));
const { runMasterPlannerOrchestration } = await import('../server/masterPlannerOrchestrator');
beforeEach(() => { state.active = true; state.startupError = false; vi.clearAllMocks(); });

it('does not start real providers without a durable execution claim', async () => {
  await expect(runMasterPlannerOrchestration(990010, 1)).rejects.toThrow('durable execution claim');
});
it('fences the next provider dispatch when the claim is lost while an earlier provider is in flight', async () => {
  const generateInviteConcepts = vi.fn(async () => {
    state.active = false;
    return [{ layoutStyle: 'banner', dnaHints: {} }];
  });
  const generateIllustration = vi.fn();
  await expect(runMasterPlannerOrchestration(990010, 1,
    { generateInviteConcepts, generateIllustration } as any, 123)).rejects.toThrow('Claim lost');
  expect(generateInviteConcepts).toHaveBeenCalledTimes(1);
  expect(generateIllustration).not.toHaveBeenCalled(); expect(persist).not.toHaveBeenCalled();
});
it('records startup failures through the fenced store rather than leaving a running claim behind', async () => {
  state.startupError = true;
  await expect(runMasterPlannerOrchestration(990010, 1, {} as any, 123)).rejects.toThrow('Offline read failure');
  expect(fail).toHaveBeenCalledWith('theme'); expect(persist).not.toHaveBeenCalled();
});
