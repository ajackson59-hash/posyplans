import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import Dashboard from "@/pages/Dashboard";
import Rsvp from "@/pages/Rsvp";
import Intake from "@/pages/Intake";
import DraftGenerating from "@/pages/DraftGenerating";
import DraftOverview from "@/pages/DraftOverview";
import Pricing from "@/pages/Pricing";
import CheckoutSuccess from "@/pages/CheckoutSuccess";
import Privacy from "@/pages/Privacy";
import Terms from "@/pages/Terms";
import Refund from "@/pages/Refund";
import SmsTerms from "@/pages/SmsTerms";
import EventLanding from "@/pages/EventLanding";
import Recover from "@/pages/Recover";
import { CookieConsentBanner } from "@/components/CookieConsentBanner";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/intake" component={Intake} />
      <Route path="/intake/:ownerToken" component={Intake} />
      <Route path="/draft-generating/:ownerToken" component={DraftGenerating} />
      <Route path="/draft-overview/:ownerToken" component={DraftOverview} />
      <Route path="/dashboard/:ownerToken" component={Dashboard} />
      <Route path="/rsvp/:shareSlug" component={Rsvp} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/checkout/success" component={CheckoutSuccess} />
      <Route path="/recover" component={Recover} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route path="/refund-policy" component={Refund} />
      <Route path="/sms-terms" component={SmsTerms} />
      <Route path="/baby-shower-planning" component={() => <EventLanding contentKey="baby-shower" />} />
      <Route path="/birthday-party-planning" component={() => <EventLanding contentKey="birthday" />} />
      <Route path="/graduation-party-planning" component={() => <EventLanding contentKey="graduation" />} />
      <Route path="/family-reunion-planning" component={() => <EventLanding contentKey="family-reunion" />} />
      <Route path="/holiday-party-planning" component={() => <EventLanding contentKey="holiday" />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AppRouter />
        <CookieConsentBanner />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
