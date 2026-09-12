/** Mock provider responses read task data, never infer requirements from schema. */
export function visionRequestRequirements(request: any): string[] {
  const text = request.messages[0].content.filter((part: any) => part.type === "text")
    .map((part: any) => part.text).join("\n");
  const heading = "VISIBLE MUST-HAVES (copy each requirement verbatim in requiredPresent; do not paraphrase, merge or omit):";
  const start = text.lastIndexOf(heading);
  if (start < 0) throw new Error("Review fixture did not receive the visible requirements");
  return text.slice(start + heading.length).split("EXCLUDED:")[0].split("\n")
    .filter((line: string) => line.startsWith("- ")).map((line: string) => line.slice(2));
}
