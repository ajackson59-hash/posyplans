import { useEffect, useRef } from "react";
import { useSearchParams } from "wouter";

const tabs = ["theme", "guests", "budget", "menu", "shopping", "timeline"] as const;
export type DashboardTab = typeof tabs[number];

function validTab(value: string | null): DashboardTab | null {
  return tabs.includes(value as DashboardTab) ? value as DashboardTab : null;
}

function storageKey(ownerToken: string) {
  return `pp_dashboard_tab:${ownerToken}`;
}

function rememberedTab(ownerToken: string): DashboardTab | null {
  try {
    return validTab(window.localStorage.getItem(storageKey(ownerToken)));
  } catch {
    return null;
  }
}

export function useDashboardNavigation(ownerToken: string, ready: boolean) {
  const [params, setParams] = useSearchParams();
  const explicitTab = validTab(params.get("tab"));
  const savedTab = rememberedTab(ownerToken);
  const activeTab = explicitTab ?? savedTab ?? "theme";
  const restoredOwner = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || restoredOwner.current === ownerToken) return;
    // A return visit resumes at the remembered workspace, not above the long
    // planning overview. New visitors still see the invitation entry point.
    if (!explicitTab && !savedTab) {
      restoredOwner.current = ownerToken;
      return;
    }
    const frame = requestAnimationFrame(() => {
      restoredOwner.current = ownerToken;
      document.getElementById("event-tabs-section")?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [ownerToken, ready, explicitTab, savedTab]);

  useEffect(() => {
    if (!explicitTab) return;
    try {
      window.localStorage.setItem(storageKey(ownerToken), explicitTab);
    } catch {
      // A private-browser session can still resume through the URL.
    }
  }, [ownerToken, explicitTab]);

  const setActiveTab = (value: string) => {
    const tab = validTab(value);
    if (!tab) return;
    try {
      window.localStorage.setItem(storageKey(ownerToken), tab);
    } catch {
      // The URL still preserves the selection when browser storage is blocked.
    }
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.set("tab", tab);
      return next;
    }, { replace: true, state: window.history.state });
  };

  return { activeTab, setActiveTab };
}
