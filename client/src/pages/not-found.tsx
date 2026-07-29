import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-6">
      <Card className="w-full max-w-md border-card-border shadow-sm" data-testid="card-not-found">
        <CardContent className="pt-6 pb-6 text-center">
          <div className="mb-4 flex justify-center">
            <Compass className="h-8 w-8 text-primary" />
          </div>
          <h1 className="font-serif text-lg font-semibold text-foreground">
            We couldn't find that page
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The link may be out of date, or the page may have moved. Let's get you back on track.
          </p>
          <Button asChild className="mt-6" data-testid="button-not-found-home">
            <Link href="/">Back to home</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
