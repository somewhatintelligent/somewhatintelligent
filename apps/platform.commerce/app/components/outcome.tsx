/**
 * What the domain said, rendered.
 *
 * REFUSALS ARE THE PRODUCT HERE. Publish refuses rather than warns —
 * `missing_variant`, `missing_media`, `no_release` — and those sentences are
 * how an operator learns the sequence the lifecycle enforces. A console that
 * collapsed them into "something went wrong" would delete the only part of the
 * interaction that teaches anything.
 */
import { Alert, AlertDescription, AlertTitle } from "platform.ui/components/alert";

/**
 * Whatever was thrown, as a sentence.
 *
 * `String(unknown)` renders a plain object as `[object Object]`, which is the
 * least useful thing a failed mutation could say. Tagged errors arrive from the
 * RPC bridge as bare objects carrying `_tag`, so they need naming rather than
 * stringifying.
 */
const describe = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const tagged = error as { _tag?: unknown; message?: unknown };
    if (typeof tagged.message === "string") return tagged.message;
    if (typeof tagged._tag === "string") return tagged._tag;
    return JSON.stringify(error);
  }
  return JSON.stringify(error) ?? "unknown failure";
};

export function Outcome({
  error,
  done,
  className,
}: {
  error?: unknown;
  done?: string | null;
  className?: string;
}) {
  if (error) {
    const message = describe(error);
    return (
      <Alert variant="destructive" className={className}>
        <AlertTitle>Refused</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    );
  }
  if (done) {
    return (
      <Alert variant="success" className={className}>
        <AlertDescription>{done}</AlertDescription>
      </Alert>
    );
  }
  return null;
}

/** A quieter inline note — for the guidance under a form, not an outcome. */
export function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
