import { isIP } from "node:net";
import type { Event } from "@shared/schema";
import type {
  ArtworkReferenceImage,
  ArtworkReferenceMimeType,
} from "./aiFirst/artwork";
import type { NamedCreativeReference } from "./prePaymentPreviewQuality";

const MAX_IMAGE_BYTES = 12_000_000;
const MAX_HTML_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 10_000;
const POSITIVE_CACHE_MS = 6 * 60 * 60 * 1000;
const NEGATIVE_CACHE_MS = 10 * 60 * 1000;

interface CuratedReferenceSource {
  imageUrls?: string[];
  pageUrls?: string[];
  notes: string;
}

const CURATED_REFERENCE_SOURCES: Readonly<Record<string, CuratedReferenceSource>> = {
  "blippi-meekah": {
    imageUrls: [
      "https://static.wixstatic.com/media/d70790_b92fd5c92e4c4f0f9b1bc5b210e63a49~mv2.png",
      "https://static.wixstatic.com/media/d70790_9f3656b5950649a0b97994a75c065b84~mv2.png",
      "https://static.wixstatic.com/media/d70790_c915ef772bd144dc9662ccc457f88932~mv2.png",
    ],
    pageUrls: ["https://www.blippi.com/about"],
    notes:
      "Official Blippi visual references show Blippi as a full adult host in a bright blue shirt, orange suspenders, orange bow tie, orange glasses and blue-and-orange cap. Official Meekah references show a distinct adult woman with natural curly hair and a purple-and-orange play-and-learn outfit. Keep both hosts recognizable, together and central; do not substitute an isolated bow tie, palette, logo or generic second adult.",
  },
  "unicorn-academy": {
    imageUrls: [
      "https://cdn.prod.website-files.com/64b69cbacda0592c92130359/64b827c0b3cb21467d257047_character_single_01_sophia-unicorn.png",
      "https://cdn.prod.website-files.com/64b69cbacda0592c92130359/64b7f7f9c553df802bd8435f_character_single_02_layla-unicorn.png",
    ],
    notes:
      "Official Unicorn Academy references show polished animated academy-age riders in jewel-toned riding uniforms, each paired with a visually distinct bonded magical unicorn. Preserve recognizable rider-and-unicorn pair design, markings, silhouettes and academy-world styling; do not substitute generic children, generic horses, rainbow clipart or an unrelated unicorn party.",
  },
  "kpop-demon-hunters": {
    imageUrls: [
      "https://dnm.nflximg.net/api/v6/BvVbc2Wxr2w6QuoANoSpJKEIWjQ/AAAAQZu7fE3XIPeh5EY0PBW3_n7oFzRY_pWGn6hChbJN7Owl21mhmPnwZlYmVSk93Spi2OnB5oReC6cAwN4MtO3zvyGLaIfMq9VfRV1ds7VdvbxsgxXVZf_mGHDFfLY7KHP6HlT4HAGw1cLuOPkQSkO6PKpvQTk.jpg?r=a20",
    ],
    pageUrls: [
      "https://www.netflix.com/tudum/articles/kpop-demon-hunters-cast",
      "https://www.netflix.com/tudum/kpop-demon-hunters",
    ],
    notes:
      "Official Netflix visual references show Rumi, Mira and Zoey as three distinct stylized animated young women with different faces, hair silhouettes and coordinated contemporary K-pop performance styling. Preserve all three as central performers and add unmistakable supernatural hunter energy; do not substitute a generic girl group or abstract neon.",
  },
  "paw-patrol": {
    imageUrls: [
      "https://cdn.prod.website-files.com/63f8ef5c5a8680f76905bcd2/64a27bb5fa8e6bfde362140f_ForKids-Paw-Patrol.webp",
      "https://images.ctfassets.net/47xts72n4555/6GN9L4mUsTmZXPshFr4ggS/7a759ce2b51b709dd4ed3650407d8138/character-guide-chase-poster.jpg",
    ],
    pageUrls: ["https://webflow.pawpatrol-application.com/character-guide"],
    notes:
      "Official PAW Patrol references show multiple distinct animated puppy breeds with recognizable colored rescue uniforms, badges, packs and job-specific gear. Preserve the rescue-team identity and Adventure Bay energy; do not substitute generic puppies in random hats.",
  },
  bluey: {
    imageUrls: [
      "https://www.bluey.tv/wp-content/uploads/2023/07/Bluey.png",
      "https://www.bluey.tv/wp-content/uploads/2023/07/B2.png",
    ],
    pageUrls: [
      "https://www.bluey.tv/characters/bluey/",
      "https://www.bluey.tv/characters/bingo/",
    ],
    notes:
      "Official Bluey references show the recognizable flat 2D blue-heeler family world, with specific rounded dog silhouettes, blue and warm-orange color blocking and playful Australian-home energy. Preserve the recognizable family-world design; do not substitute generic blue dogs or realistic animals.",
  },
};

export interface ResolvedNamedReference {
  images: ArtworkReferenceImage[];
  notes: string;
  strategy: "curated" | "web-search";
  sourcePages: string[];
}

export interface NamedReferenceResolverDependencies {
  fetchImpl?: typeof fetch;
  now?: () => number;
  apiKey?: string;
  searchModel?: string;
}

interface CachedResolution {
  expiresAt: number;
  value: ResolvedNamedReference | null;
}

const cache = new Map<string, CachedResolution>();

function isSafePublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (url.port && url.port !== "443") return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host || isIP(host) !== 0) return false;
    if (
      host === "localhost"
      || host.endsWith(".localhost")
      || host.endsWith(".local")
      || host.endsWith(".internal")
      || host.endsWith(".lan")
      || host.endsWith(".home")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function fetchWithGuard(
  input: string,
  fetchImpl: typeof fetch,
  init: RequestInit,
  maxRedirects = 3,
): Promise<Response> {
  let current = input;
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    if (!isSafePublicHttpsUrl(current)) throw new Error("unsafe reference URL");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetchImpl(current, {
        ...init,
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirect === maxRedirects) throw new Error("reference redirect failed");
        current = new URL(location, current).toString();
        continue;
      }
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("reference redirect limit reached");
}

function imageMimeFromBytes(bytes: Buffer): ArtworkReferenceMimeType | null {
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function extensionForMime(mimeType: ArtworkReferenceMimeType): string {
  return mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
}

async function fetchReferenceImage(
  url: string,
  fetchImpl: typeof fetch,
  index: number,
): Promise<ArtworkReferenceImage | null> {
  try {
    const response = await fetchWithGuard(url, fetchImpl, {
      method: "GET",
      headers: {
        Accept: "image/png,image/jpeg,image/webp,image/*;q=0.8",
        "User-Agent": "PosyVisualReferenceResolver/1.0",
      },
    });
    if (!response.ok) return null;
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_IMAGE_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
    const mimeType = imageMimeFromBytes(bytes);
    if (!mimeType) return null;
    return {
      bytes,
      mimeType,
      filename: `automatic-reference-${index + 1}.${extensionForMime(mimeType)}`,
    };
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x2f;|&#47;/gi, "/")
    .replace(/&#x3a;|&#58;/gi, ":");
}

interface PageImageCandidate {
  url: string;
  context: string;
  score: number;
}

function candidateScore(url: string, context: string, reference: NamedCreativeReference): number {
  const haystack = `${url} ${context}`.toLowerCase();
  const tokens = Array.from(new Set(
    `${reference.label} ${reference.cues.join(" ")}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4),
  ));
  let score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 4 : 0), 0);
  if (/character|cast|hero|official|group|team|family|rider|unicorn|blippi|meekah|bluey|bingo|chase|rumi|mira|zoey/.test(haystack)) score += 5;
  if (/og:image|twitter:image/.test(context.toLowerCase())) score += 6;
  if (/logo|icon|favicon|sprite|badge|pattern|background|placeholder|loading/.test(haystack)) score -= 14;
  if (/\.(?:png|jpe?g|webp)(?:[?#]|$)/i.test(url)) score += 2;
  return score;
}

function collectImageCandidates(
  html: string,
  pageUrl: string,
  reference: NamedCreativeReference,
): PageImageCandidate[] {
  const found: PageImageCandidate[] = [];
  const add = (rawUrl: string, context: string) => {
    const decoded = decodeHtmlEntities(rawUrl.trim());
    if (!decoded || decoded.startsWith("data:")) return;
    try {
      const absolute = new URL(decoded, pageUrl).toString();
      if (!isSafePublicHttpsUrl(absolute)) return;
      found.push({ url: absolute, context, score: candidateScore(absolute, context, reference) });
    } catch {
      // Ignore malformed page markup.
    }
  };

  for (const match of Array.from(html.matchAll(/<meta\b[^>]*(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*content=["']([^"']+)["'][^>]*>/gi))) {
    add(match[1], match[0]);
  }
  for (const match of Array.from(html.matchAll(/<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*>/gi))) {
    add(match[1], match[0]);
  }
  for (const match of Array.from(html.matchAll(/<img\b[^>]*>/gi))) {
    const tag = match[0];
    const source = /(?:src|data-src|data-lazy-src)=["']([^"']+)["']/i.exec(tag)?.[1];
    if (source) add(source, tag);
    const srcset = /(?:srcset|data-srcset)=["']([^"']+)["']/i.exec(tag)?.[1];
    if (srcset) {
      for (const part of srcset.split(",")) {
        const candidate = part.trim().split(/\s+/)[0];
        if (candidate) add(candidate, tag);
      }
    }
  }
  for (const match of Array.from(html.matchAll(/["'](?:image|contentUrl|thumbnailUrl)["']\s*:\s*["']([^"']+)["']/gi))) {
    add(match[1], match[0]);
  }

  const bestByUrl = new Map<string, PageImageCandidate>();
  for (const candidate of found) {
    const existing = bestByUrl.get(candidate.url);
    if (!existing || candidate.score > existing.score) bestByUrl.set(candidate.url, candidate);
  }
  return Array.from(bestByUrl.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 18);
}

async function fetchPageCandidates(
  pageUrl: string,
  reference: NamedCreativeReference,
  fetchImpl: typeof fetch,
): Promise<PageImageCandidate[]> {
  try {
    const response = await fetchWithGuard(pageUrl, fetchImpl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "PosyVisualReferenceResolver/1.0",
      },
    });
    if (!response.ok) return [];
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_HTML_BYTES) return [];
    const html = await response.text();
    if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) return [];
    return collectImageCandidates(html, pageUrl, reference);
  } catch {
    return [];
  }
}

function responseTextAndUrls(payload: unknown): { text: string; urls: string[] } {
  const data = payload as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string; annotations?: Array<{ url?: string }> }> }>;
  };
  const textParts: string[] = [];
  const urls: string[] = [];
  if (typeof data.output_text === "string") textParts.push(data.output_text);
  for (const item of data.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") textParts.push(content.text);
      for (const annotation of content.annotations ?? []) {
        if (typeof annotation.url === "string") urls.push(annotation.url);
      }
    }
  }
  const text = textParts.join("\n");
  for (const match of Array.from(text.matchAll(/https:\/\/[^\s\]})>"']+/g))) urls.push(match[0]);
  return { text, urls: Array.from(new Set(urls.filter(isSafePublicHttpsUrl))) };
}

async function searchOfficialPages(
  event: Event,
  reference: NamedCreativeReference,
  fetchImpl: typeof fetch,
  apiKey: string | undefined,
  searchModel: string,
): Promise<string[]> {
  if (!apiKey) return [];
  const prompt = [
    `Find the official first-party rights-holder or official brand pages for the visual identity "${reference.label}".`,
    `The event context is: ${event.eventName || "event"}. ${event.vibeDescription || ""}`,
    "Return two to four HTTPS page URLs that visibly show the central characters or visual world.",
    "Use only official publisher, studio, broadcaster, streaming-service, or brand-owned pages. Exclude retailers, fan wikis, social-media reposts, Pinterest, stock sites, blogs and search-result pages.",
    "Prefer stable character, cast, title, or official-about pages. Output only the URLs, one per line.",
  ].join(" ");

  try {
    const response = await fetchWithGuard("https://api.openai.com/v1/responses", fetchImpl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: searchModel,
        tools: [{ type: "web_search" }],
        input: prompt,
        max_output_tokens: 700,
      }),
    });
    if (!response.ok) return [];
    const parsed = responseTextAndUrls(await response.json());
    return parsed.urls.slice(0, 6);
  } catch {
    return [];
  }
}

async function collectImages(
  directImageUrls: string[],
  pageUrls: string[],
  reference: NamedCreativeReference,
  fetchImpl: typeof fetch,
): Promise<ArtworkReferenceImage[]> {
  const images: ArtworkReferenceImage[] = [];
  const seen = new Set<string>();
  const tryImage = async (url: string) => {
    if (images.length >= 2 || seen.has(url)) return;
    seen.add(url);
    const image = await fetchReferenceImage(url, fetchImpl, images.length);
    if (image) images.push(image);
  };

  for (const url of directImageUrls) await tryImage(url);
  if (images.length >= 2) return images;

  for (const pageUrl of pageUrls) {
    const candidates = await fetchPageCandidates(pageUrl, reference, fetchImpl);
    for (const candidate of candidates) {
      if (candidate.score < 0) continue;
      await tryImage(candidate.url);
      if (images.length >= 2) return images;
    }
  }
  return images;
}

export function namedReferenceAutoResolutionEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const configured = env.POSY_NAMED_PREVIEW_AUTO_RESOLVE?.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(configured || "")) return true;
  if (["0", "false", "no", "off"].includes(configured || "")) return false;
  return env.VERCEL_ENV === "preview"
    && env.VERCEL_GIT_COMMIT_REF === "fix/launch-qa-find-my-event-label";
}

export async function resolveNamedCreativeReference(
  event: Event,
  reference: NamedCreativeReference,
  dependencies: NamedReferenceResolverDependencies = {},
): Promise<ResolvedNamedReference | null> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? Date.now;
  const cacheKey = `${reference.id}:${reference.label}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now()) return cached.value;

  const curated = CURATED_REFERENCE_SOURCES[reference.id];
  if (curated) {
    const images = await collectImages(
      curated.imageUrls ?? [],
      curated.pageUrls ?? [],
      reference,
      fetchImpl,
    );
    if (images.length > 0) {
      const resolved: ResolvedNamedReference = {
        images,
        notes: curated.notes,
        strategy: "curated",
        sourcePages: [...(curated.pageUrls ?? [])],
      };
      cache.set(cacheKey, { expiresAt: now() + POSITIVE_CACHE_MS, value: resolved });
      return resolved;
    }
  }

  const searchModel = dependencies.searchModel
    ?? process.env.POSY_REFERENCE_SEARCH_MODEL
    ?? "gpt-5-mini";
  const pages = await searchOfficialPages(
    event,
    reference,
    fetchImpl,
    dependencies.apiKey ?? process.env.OPENAI_API_KEY,
    searchModel,
  );
  const images = await collectImages([], pages, reference, fetchImpl);
  if (images.length > 0) {
    const resolved: ResolvedNamedReference = {
      images,
      notes: [
        `Official first-party visual references were resolved automatically for ${reference.label}.`,
        ...reference.requirements,
      ].join(" "),
      strategy: "web-search",
      sourcePages: pages,
    };
    cache.set(cacheKey, { expiresAt: now() + POSITIVE_CACHE_MS, value: resolved });
    return resolved;
  }

  cache.set(cacheKey, { expiresAt: now() + NEGATIVE_CACHE_MS, value: null });
  return null;
}

export function clearNamedReferenceResolverCache(): void {
  cache.clear();
}
