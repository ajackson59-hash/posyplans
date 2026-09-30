import { MEDIUM_FEASIBILITY_CASES } from '../../server/aiFirst/mediumFeasibilityCases';

/** Fresh customer-flow screening proposal. Reuse frozen briefs for comparison,
 * never previous event IDs, allowances, verdicts or paid dispatch claims. */
const order = [4, 0, 1, 2, 3, 5, 6, 7];
const refinements = [
  'Give the orange and ivory bunting more breathing room around the crane. Preserve both machines, their connections, the sand-play area, garden and watercolor treatment. Do not add subjects or lettering.',
  'Make the floating bubbles easier to see against the soft-play background. Preserve Blippi and Meekah, their dancing poses, the ball pit, foam structures, ice-cream counter and gouache treatment.',
  'Give the blue cake more breathing room from the lower edge. Preserve Elsa and Anna, their original film costumes, the ice arch, snowy garden and cel-shaded treatment. No new characters or lettering.',
  'Make the concert-light ribbons slightly brighter. Preserve Rumi, Mira and Zoey, each face, hairstyle, canonical stage clothing, microphones, rooftop skyline and anime treatment.',
  'Make the hibiscus a little more prominent. Preserve Moana and Maui, their identities, the outrigger canoe, waves, picnic, beach and stylized 3D treatment.',
  'Make the hanging lantern light slightly warmer. Preserve exactly six complete place settings, ivory flowers, linen, glassware, dusk lighting and photographic realism.',
  'Increase the negative space between the cobalt arches and terracotta circles. Preserve the asymmetric arrangement, ivory planes, crisp flat geometry and restrained palette. No shadows or texture.',
  'Make the embedded silver foliage details more distinct. Preserve the crescent moon, dense foliage, iridescent blue lily petals, reflective pond and polished dark lacquer inlay treatment.',
];

export const CUSTOMER_ARTWORK_QUALITY_CASES = order.map((sourceIndex, index) => {
  const source = MEDIUM_FEASIBILITY_CASES[sourceIndex];
  return { trialId: `customer-flow-20260923-${String(index + 1).padStart(2, '0')}`,
    previousBriefId: source.trialId, hostBrief: source.hostBrief, hostBriefSha256: source.hostBriefSha256,
    requestedMedium: source.requestedMedium, cohort: source.cohort, refinement: refinements[index] };
});
