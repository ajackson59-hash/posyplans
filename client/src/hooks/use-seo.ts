import { useEffect } from "react";

/**
 * Sets document.title and the meta description / canonical / OG tags for the
 * current page. This is a client-side SPA (no SSR), so this is applied on
 * mount and reverted on unmount back to the site-wide defaults in index.html.
 */
export function useSeo({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    const setMeta = (selector: string, attr: string, content: string) => {
      const el = document.querySelector(selector);
      if (el) el.setAttribute(attr, content);
    };

    const descriptionTag = document.querySelector('meta[name="description"]');
    const previousDescription = descriptionTag?.getAttribute("content") ?? "";
    setMeta('meta[name="description"]', "content", description);
    setMeta('meta[property="og:title"]', "content", title);
    setMeta('meta[property="og:description"]', "content", description);
    setMeta('meta[property="og:url"]', "content", `https://posyplans.com${path}`);
    setMeta('meta[name="twitter:title"]', "content", title);
    setMeta('meta[name="twitter:description"]', "content", description);

    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
    }
    const previousCanonical = canonical.getAttribute("href");
    canonical.setAttribute("href", `https://posyplans.com${path}`);

    return () => {
      document.title = previousTitle;
      setMeta('meta[name="description"]', "content", previousDescription);
      if (previousCanonical) {
        canonical?.setAttribute("href", previousCanonical);
      } else {
        canonical?.remove();
      }
    };
  }, [title, description, path]);
}
