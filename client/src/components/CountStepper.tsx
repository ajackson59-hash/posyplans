import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CountStepperProps {
  label: string;
  sublabel?: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  testId: string;
}

// A one-click +/- stepper for headcounts (adults, children, etc.) so guests
// never have to type a number on a phone keyboard.
export default function CountStepper({
  label,
  sublabel,
  value,
  min = 0,
  max = 20,
  onChange,
  testId,
}: CountStepperProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {sublabel && <p className="text-xs text-muted-foreground">{sublabel}</p>}
      </div>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8 flex-none"
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          data-testid={`button-${testId}-decrement`}
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <span className="w-5 text-center text-base font-semibold tabular-nums text-foreground" data-testid={`text-${testId}-value`}>
          {value}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8 flex-none"
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          data-testid={`button-${testId}-increment`}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
