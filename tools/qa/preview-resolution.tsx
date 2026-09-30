import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import DraftGenerating from "@/pages/DraftGenerating";
import "@/index.css";

// Real customer component, CSS and GET routes. Only event storage and
// entitlement are synthetic. This harness cannot generate or buy anything.
const params = new URLSearchParams(location.search);
const profile = params.get("profile") === "detail" ? "detail" : "legacy";
const { hook } = memoryLocation({ path: `/draft-generating/qa-resolution-${profile}` });
const client = new QueryClient({ defaultOptions: { queries: {
  retry: false,
  queryFn: async ({ queryKey }) => {
    const res = await fetch(String(queryKey[0]));
    if (!res.ok) throw new Error("QA request failed");
    return res.json();
  },
} } });

createRoot(document.getElementById("root")!).render(params.has("frame") ? (
  <QueryClientProvider client={client}>
    <Router hook={hook}><Route path="/draft-generating/:ownerToken" component={DraftGenerating} /></Router>
  </QueryClientProvider>
) : (
  <main style={{ padding: 16, fontFamily: "sans-serif" }}>
    <h1>Posy preview resolution - saved artwork, no generation</h1>
    <p>Real preview component and asset route; synthetic event and entitlement. Frames test CSS viewport widths; device density is measured separately.</p>
    <nav><a href="?profile=legacy">Legacy 560px</a> | <a href="?profile=detail">Detailed approval</a></nav>
    {[390, 1024].map(width => <section key={width}>
      <h2>{width === 390 ? "Mobile" : "Desktop"} - {width}px viewport - {profile}</h2>
      <iframe title={`${width}px preview`} width={width} height={1250}
        src={`?frame=1&profile=${profile}`} style={{ border: "1px solid #bbb", display: "block" }} />
    </section>)}
  </main>
));
