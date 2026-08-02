import { useEffect, useState, type ReactElement } from "react";
import { failureText, mintPreview } from "./api.ts";

interface PreviewProps {
  readonly slug: string;
  readonly name: string;
  readonly version: number;
}

/**
 * The frame loads the mezes at its own origin — `p--<token>.<artifactZone>` —
 * which is the only arrangement where the page's own `./client.js` loads.
 * Framing it under the shell's hostname gives the document an opaque origin,
 * which makes every module-script fetch cross-origin and credential-less, and
 * Access answers those with a 401 before the Worker runs.
 *
 * The origin is fetched rather than derived because the token is the server's
 * to mint; until it arrives there is nothing to frame, so the frame is absent
 * rather than pointed somewhere that will not load.
 */
export const Preview = ({ slug, name, version }: PreviewProps): ReactElement => {
  // One state, three values: null while minting, then the origin OR the reason
  // there is not one. Two independent nullables would admit a fourth state that
  // cannot happen and would have to be picked between when rendering.
  const [minted, setMinted] = useState<{ origin: string } | { failure: string } | null>(null);

  useEffect(() => {
    let live = true;
    setMinted(null);
    mintPreview(slug, version).then(
      (origin) => {
        if (live) setMinted({ origin });
      },
      (cause: unknown) => {
        if (live) setMinted({ failure: failureText(cause) });
      },
    );
    return () => {
      live = false;
    };
  }, [slug, version]);

  return (
    <div className="mz-frame">
      {/* Not decoration. The label states the property the attribute below sets. */}
      <span className="mz-frame-label">sandbox</span>
      {minted !== null && "failure" in minted ? (
        <p className="mz-frame-note">{minted.failure}</p>
      ) : null}
      {minted !== null && "origin" in minted ? (
        /*
         * `allow-scripts` and deliberately NOT `allow-same-origin`. The origin
         * is already the mezes's own and shares nothing with the shell, so this
         * is no longer what stands between model-generated JavaScript and the
         * owner's Access cookie — but a mezes has no need to reach its own
         * storage to render, and the narrower frame costs nothing.
         */
        <iframe
          key={minted.origin}
          className="mz-frame-view"
          title={`${name}, version ${String(version)}`}
          src={minted.origin}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
        />
      ) : null}
    </div>
  );
};
