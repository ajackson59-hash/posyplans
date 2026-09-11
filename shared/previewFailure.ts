export type PreviewFailureReason = "provider-blocked" | "quality-rejected" | "preview-unavailable";

export function previewFailureMessage(reason?: PreviewFailureReason | null): string {
  if (reason === "provider-blocked") return "The image service declined this artwork request. Your event details are saved.";
  if (reason === "quality-rejected") return "The artwork did not pass Posy's quality checks. Your event details are saved.";
  return "Posy couldn't complete the artwork preview. Your event details are saved.";
}
