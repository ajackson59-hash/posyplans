import { useState } from "react";
import { format, parse, isValid } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Event dates are stored as a friendly display string (e.g. "Sat, Aug 8, 2026")
// rather than a strict ISO date, since some hosts want to write things like
// "TBD" or "Weekend of Sep 12". This field gives a calendar picker for the
// common case while still allowing free-text entry/editing.
const DISPLAY_FORMAT = "EEE, MMM d, yyyy";

// Dates picked via the calendar are always written in DISPLAY_FORMAT, but
// hosts can also type freely (e.g. "August 9, 2026", "8/9/2026", "TBD").
// Try a handful of common formats so the calendar can still recognize and
// highlight the currently-selected date in those cases.
const PARSE_FORMATS = [
  DISPLAY_FORMAT,
  "MMMM d, yyyy",
  "MMM d, yyyy",
  "M/d/yyyy",
  "MM/dd/yyyy",
  "yyyy-MM-dd",
];

function tryParseDisplayDate(value: string): Date | undefined {
  if (!value) return undefined;
  for (const fmt of PARSE_FORMATS) {
    const parsed = parse(value, fmt, new Date());
    if (isValid(parsed)) return parsed;
  }
  return undefined;
}

export default function DatePickerField({
  id,
  value,
  onChange,
  onBlur,
  onDateSelect,
  placeholder = "Pick a date",
  testId,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onDateSelect?: (value: string) => void;
  placeholder?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedDate = tryParseDisplayDate(value);

  return (
    <div className="flex gap-2">
      <Input
        id={id}
        data-testid={testId}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="flex-1"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={cn("flex-none", selectedDate && "text-primary")}
            data-testid={testId ? `button-${testId}-calendar` : undefined}
            aria-label="Pick a date from the calendar"
          >
            <CalendarIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            selected={selectedDate}
            defaultMonth={selectedDate}
            onSelect={(date) => {
              if (!date) return;
              const next = format(date, DISPLAY_FORMAT);
              onChange(next);
              setOpen(false);
              // Calendar selection doesn't blur the text input, so fire the
              // save callback directly with the freshly-selected value —
              // avoids reading stale state from a closure over the old value.
              onDateSelect?.(next);
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
