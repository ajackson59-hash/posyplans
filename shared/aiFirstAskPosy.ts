// Invitation-specific Ask Posy actions.
//
// Each action is a steer plus a set of constraints to hold still. The
// constraint list is the whole point: "keep the layout, change the artwork"
// is only meaningful if the layout survives the next generation, and a plain
// free-text steer cannot promise that. So every action declares what it pins,
// and the server carries the pinned constraints into the prompt verbatim
// under KEEP UNCHANGED.
//
// The catalogue is shared because the labels are host-facing and the ids are
// what the client posts back; two copies would drift.

export type AskPosyActionId =
  | "refine"
  | "different-directions"
  | "keep-layout-change-art"
  | "keep-art-change-typography"
  | "more-elegant"
  | "more-playful"
  | "more-modern"
  | "less-literal"
  | "stronger-theme"
  | "help-choose";

export type AskPosyPin = "layout" | "artwork" | "typography" | "palette";

export interface AskPosyAction {
  id: AskPosyActionId;
  label: string;
  /** Appended as HOST DIRECTION. */
  direction: string;
  /** Which facets of the current concept to pin, if one is selected. */
  pins: AskPosyPin[];
  /** Advisory only — produces guidance, never a generation. */
  advisory?: boolean;
}

export const INVITATION_ASK_POSY_ACTIONS: AskPosyAction[] = [
  {
    id: "refine",
    label: "Refine this invitation",
    direction: "Refine the selected direction. Keep its identity; sharpen the craft.",
    pins: ["layout", "palette"],
  },
  {
    id: "different-directions",
    label: "Create different directions",
    direction: "Go somewhere genuinely different from what the host has already seen.",
    pins: [],
  },
  {
    id: "keep-layout-change-art",
    label: "Keep the layout, change the artwork",
    direction:
      "Keep the composition exactly as it is and replace the illustration with a different subject and treatment.",
    pins: ["layout", "typography"],
  },
  {
    id: "keep-art-change-typography",
    label: "Keep the artwork, change the typography",
    direction: "Keep the illustration brief identical and reset the type: different pairing, different hierarchy.",
    pins: ["artwork", "palette"],
  },
  {
    id: "more-elegant",
    label: "More elegant",
    direction: "More elegant: restrained palette, finer detail, more negative space, quieter type.",
    pins: [],
  },
  {
    id: "more-playful",
    label: "More playful",
    direction: "More playful: livelier colour, looser mark-making, more energy — without becoming childish.",
    pins: [],
  },
  {
    id: "more-modern",
    label: "More modern",
    direction: "More modern: contemporary shapes, cleaner geometry, current editorial typography.",
    pins: [],
  },
  {
    id: "less-literal",
    label: "Reduce literal elements",
    direction: "Say the theme through colour, material and mood rather than depicting its objects literally.",
    pins: [],
  },
  {
    id: "stronger-theme",
    label: "Strengthen the theme",
    direction: "Make the theme unmistakable at a glance — the guest should know what this celebrates before reading a word.",
    pins: [],
  },
  {
    id: "help-choose",
    label: "Help me choose",
    direction: "",
    pins: [],
    advisory: true,
  },
];
