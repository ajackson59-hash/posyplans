import { crossThemeProfile, CROSS_THEME_CASES, type CrossThemeCaseId } from "./crossThemeReviewProfiles";

export const COMPACT_REVIEW_CASES = [...CROSS_THEME_CASES.map(c => ({ caseId: c.caseId as string, image: c.image as string })),
  { caseId: "c13", image: "zoey" }, { caseId: "c14", image: "zoey" }];
/** c13/c14 preserve the existing complete Zoey/Rumi requests on Zoey pixels.
 * Expected answers and returned human notes are not in these task profiles. */
export async function compactReviewProfile(caseId: string) {
  if (!COMPACT_REVIEW_CASES.some(c => c.caseId === caseId)) throw Error("compact-unknown-case");
  return crossThemeProfile((caseId === "c13" ? "c06" : caseId === "c14" ? "c05" : caseId) as CrossThemeCaseId);
}
