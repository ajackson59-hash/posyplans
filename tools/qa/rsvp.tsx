// The real public RSVP page — envelope open, composed invitation, RSVP form —
// showing an event whose applied design came from the AI-first pipeline.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import Rsvp from "@/pages/Rsvp";
import { Toaster } from "@/components/ui/toaster";
import "@/index.css";

const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, queryFn: async ({ queryKey }) => (await fetch(String(queryKey[0]))).json() },
  },
});

const { hook } = memoryLocation({ path: "/rsvp/qa" });

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <Router hook={hook}>
      <Route path="/rsvp/:shareSlug" component={Rsvp} />
    </Router>
    <Toaster />
  </QueryClientProvider>,
);
