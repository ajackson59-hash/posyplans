import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequestJson } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PlusChallenge {
  id: string;
  expiresAt: number;
  resendAt: number;
}
interface PlusLinkStatus {
  enabled: boolean;
  linked: boolean;
  challenge?: PlusChallenge;
}
interface CodeRequestResult {
  ok: true;
  challengeId: string;
  expiresAt: number;
  resendAt: number;
}

const EMAIL_LOOKS_VALID = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_SENT_MESSAGE = "If an active Plus membership uses this billing email, a code is on its way.";

export default function PlusMembershipLink({ ownerToken, onLinked }: {
  ownerToken: string;
  onLinked: () => void;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [saveRecoveryEmail, setSaveRecoveryEmail] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Keep the same key for an explicitly retried request whose response was
  // lost. Neither the billing email nor the code is saved in browser storage.
  const pendingRequest = useRef<{ email: string; key: string } | null>(null);
  const refreshedLinkedAccess = useRef(false);
  const basePath = `/api/events/owner/${ownerToken}/plus-link`;
  const queryKey = ["plus-membership-link", ownerToken];
  const status = useQuery<PlusLinkStatus>({
    queryKey,
    queryFn: () => apiRequestJson<PlusLinkStatus>("GET", basePath),
    retry: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const challenge = status.data?.challenge;
  const expiresAt = challenge?.expiresAt;

  useEffect(() => {
    // Consent belongs to this verification attempt, never a previous address
    // or browser session. A restored challenge starts unchecked as well.
    setSaveRecoveryEmail(false);
  }, [challenge?.id]);

  useEffect(() => {
    if (status.data?.linked && !refreshedLinkedAccess.current) {
      refreshedLinkedAccess.current = true;
      onLinked();
    }
  }, [status.data?.linked, onLinked]);

  useEffect(() => {
    if (!expiresAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  const requestCode = useMutation({
    retry: false,
    mutationFn: async () => {
      const billingEmail = email.trim();
      if (pendingRequest.current?.email !== billingEmail) {
        pendingRequest.current = { email: billingEmail, key: crypto.randomUUID() };
      }
      return apiRequestJson<CodeRequestResult>("POST", `${basePath}/request`, {
        email: billingEmail,
        requestKey: pendingRequest.current.key,
      });
    },
    onSuccess: result => {
      setCode("");
      setNow(Date.now());
      pendingRequest.current = null;
      queryClient.setQueryData<PlusLinkStatus>(queryKey, {
        enabled: true,
        linked: false,
        challenge: { id: result.challengeId, expiresAt: result.expiresAt, resendAt: result.resendAt },
      });
    },
    // Resolve an uncertain delivery by reading status; never resend on a
    // network error, remount, or return from the host's email app.
    onError: async () => {
      const saved = await status.refetch();
      if (saved.data?.challenge && saved.data.challenge.id !== challenge?.id) pendingRequest.current = null;
    },
  });
  const confirmCode = useMutation({
    retry: false,
    mutationFn: async () => {
      const result = await apiRequestJson<{ ok: boolean; linked: boolean }>("POST", `${basePath}/confirm`, {
        challengeId: challenge?.id,
        code,
        ...(saveRecoveryEmail ? { saveRecoveryEmail: true } : {}),
      });
      if (!result.ok || !result.linked) throw new Error("Verification incomplete");
      return result;
    },
    onSuccess: () => {
      setCode("");
      pendingRequest.current = null;
      queryClient.setQueryData<PlusLinkStatus>(queryKey, { enabled: true, linked: true });
    },
    onError: async () => {
      // A lost confirmation response can still have saved the binding. Read
      // that result before offering another code attempt, without resending.
      const saved = await status.refetch();
      if (saved.data?.linked) {
        setCode("");
        pendingRequest.current = null;
      }
    },
  });

  const busy = requestCode.isPending || confirmCode.isPending;
  const cooldownSeconds = challenge ? Math.max(0, Math.ceil((challenge.resendAt - now) / 1000)) : 0;
  const expired = !!challenge && challenge.expiresAt <= now;
  const showForm = status.data?.enabled === true && !status.data.linked;

  return <div className="mx-auto w-full max-w-sm text-center" data-testid="already-plus-panel">
    <button
      type="button"
      onClick={() => setExpanded(current => !current)}
      aria-expanded={expanded}
      aria-controls="plus-access-help"
      data-testid="button-show-plus-access"
      className="text-sm font-medium text-primary underline underline-offset-2"
    >Already on Plus? Find your access</button>
    {expanded ? <div id="plus-access-help" className="mt-3 space-y-4 rounded-lg border border-border p-4 text-left text-sm" data-testid="plus-access-help">
      <p>You don't need to purchase again. Connect your Plus membership or open your existing paid event.</p>
      {status.isPending ? <p role="status">Checking your saved access…</p> : null}
      {status.data?.linked ? <p role="status">Plus is connected to this event.</p> : null}
      {showForm ? <>
        <form className="space-y-3" onSubmit={event => {
          event.preventDefault();
          if (busy || cooldownSeconds > 0 || !EMAIL_LOOKS_VALID.test(email.trim())) return;
          confirmCode.reset();
          requestCode.mutate();
        }}>
          <div className="space-y-1.5">
            <Label htmlFor="plus-billing-email">Plus billing email</Label>
            <Input id="plus-billing-email" data-testid="input-plus-email" type="email" autoComplete="email" required
              value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />
          </div>
          <Button type="submit" variant="outline" className="w-full" disabled={busy || cooldownSeconds > 0 || !EMAIL_LOOKS_VALID.test(email.trim())}>
            {requestCode.isPending ? "Requesting your code…" : cooldownSeconds > 0 ? `Resend available in ${cooldownSeconds}s` : challenge ? "Email a new code" : "Email my code"}
          </Button>
        </form>
        {challenge ? <div className="space-y-3">
          <p role="status" className="text-xs text-muted-foreground">{CODE_SENT_MESSAGE}</p>
          {expired ? <p role="status">This code has expired. Enter your billing email above to request a new one.</p> : <form className="space-y-3" onSubmit={event => {
            event.preventDefault();
            if (busy || !/^\d{8}$/.test(code)) return;
            confirmCode.mutate();
          }}>
            <div className="space-y-1.5">
              <Label htmlFor="plus-verification-code">8-digit verification code</Label>
              <Input id="plus-verification-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" maxLength={8} required
                value={code} onChange={event => { setCode(event.target.value.replace(/\D/g, "").slice(0, 8)); confirmCode.reset(); }} disabled={busy} />
            </div>
            <div className="flex items-start gap-2">
              <input id="plus-save-recovery-email" type="checkbox" checked={saveRecoveryEmail}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary" aria-describedby="plus-recovery-email-note"
                onChange={event => setSaveRecoveryEmail(event.target.checked)} disabled={busy} />
              <Label htmlFor="plus-save-recovery-email" className="text-xs font-normal leading-relaxed">
                Use this verified billing email to recover this event
              </Label>
            </div>
            <p id="plus-recovery-email-note" className="text-xs text-muted-foreground">If a recovery email is already saved, it will stay unchanged.</p>
            <Button type="submit" className="w-full" disabled={busy || !/^\d{8}$/.test(code)}>{confirmCode.isPending ? "Verifying…" : "Connect my Plus membership"}</Button>
          </form>}
        </div> : null}
        {requestCode.isError ? <p role="alert">We couldn't confirm your code request. Check your inbox before trying again.</p> : null}
        {confirmCode.isError ? <p role="alert">We couldn't verify that code. Check the code or request a new one when available.</p> : null}
      </> : null}
      <Link href="/recover" className="block font-medium text-primary underline underline-offset-2">Find my paid event</Link>
      <p className="text-xs text-muted-foreground">Need help connecting Plus? Contact <a href="mailto:hello@posyplans.com?subject=Plus%20access" className="text-primary underline underline-offset-2">hello@posyplans.com</a>. Your event details are saved.</p>
    </div> : null}
  </div>;
}
