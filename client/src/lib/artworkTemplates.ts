// Curated set of ready-made invitation artwork banners hosts can pick from
// without needing to upload their own image. Selecting a template just sets
// the same `inviteArtworkUrl` field that a custom upload would set — the
// preview/RSVP page display logic doesn't need to know the difference.
import golf from "@/assets/templates/template-golf.jpg";
import superhero from "@/assets/templates/template-superhero.jpg";
import princess from "@/assets/templates/template-princess.jpg";
import underTheSea from "@/assets/templates/template-under-the-sea.jpg";
import safari from "@/assets/templates/template-safari.jpg";
import unicorn from "@/assets/templates/template-unicorn.jpg";
import sports from "@/assets/templates/template-sports.jpg";
import beach from "@/assets/templates/template-beach.jpg";
import rusticFarmhouse from "@/assets/templates/template-rustic-farmhouse.jpg";
import floralGarden from "@/assets/templates/template-floral-garden.jpg";
import winterHoliday from "@/assets/templates/template-winter-holiday.jpg";
import elegantNeutral from "@/assets/templates/template-elegant-neutral.jpg";
import festiveConfetti from "@/assets/templates/template-festive-confetti.jpg";

export interface ArtworkTemplate {
  id: string;
  label: string;
  url: string;
}

export const ARTWORK_TEMPLATES: ArtworkTemplate[] = [
  { id: "elegant-neutral", label: "Elegant neutral", url: elegantNeutral },
  { id: "festive-confetti", label: "Festive confetti", url: festiveConfetti },
  { id: "golf", label: "Golf / Hole in One", url: golf },
  { id: "superhero", label: "Superhero", url: superhero },
  { id: "princess", label: "Princess / Fairy Tale", url: princess },
  { id: "under-the-sea", label: "Under the Sea", url: underTheSea },
  { id: "safari", label: "Safari / Jungle", url: safari },
  { id: "unicorn", label: "Unicorn & Rainbow", url: unicorn },
  { id: "sports", label: "Sports (All-Star)", url: sports },
  { id: "beach", label: "Beach / Tropical Luau", url: beach },
  { id: "rustic-farmhouse", label: "Rustic Farmhouse", url: rusticFarmhouse },
  { id: "floral-garden", label: "Enchanted Garden", url: floralGarden },
  { id: "winter-holiday", label: "Holiday / Winter Wonderland", url: winterHoliday },
];
