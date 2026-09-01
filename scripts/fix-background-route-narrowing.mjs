import { readFileSync, writeFileSync } from "node:fs";

const path = "server/prePaymentPreviewQualityRoutes.ts";
const text = readFileSync(path, "utf8");
const oldValue = `      event = await reservePreviewAttempt(store, event, timestamp);
      schedule(() => runAutomaticNamedPreviewJob({
        store,
        event,
        namedReference,
        resolveNamedReference,
        generate,
        now,
      }));

      res.setHeader("Retry-After", String(Math.ceil(POLL_AFTER_MS / 1000)));
      return res.status(202).json(readiness(event, mode, namedAutoEnabled, timestamp));
`;
const newValue = `      const reservedEvent = await reservePreviewAttempt(store, event, timestamp);
      event = reservedEvent;
      schedule(() => runAutomaticNamedPreviewJob({
        store,
        event: reservedEvent,
        namedReference,
        resolveNamedReference,
        generate,
        now,
      }));

      res.setHeader("Retry-After", String(Math.ceil(POLL_AFTER_MS / 1000)));
      return res.status(202).json(readiness(reservedEvent, mode, namedAutoEnabled, timestamp));
`;
const count = text.split(oldValue).length - 1;
if (count !== 1) throw new Error(`Expected one background reservation block; found ${count}`);
writeFileSync(path, text.replace(oldValue, newValue));
console.log("Background route narrowing fixed.");
