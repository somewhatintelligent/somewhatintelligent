import { useEffect, useState, type MouseEvent, type ReactElement } from "react";
import { failureText, listMezedes, type MezesSummary } from "./api.ts";
import { CardArt } from "./artwork.tsx";
import { plural, shortAge } from "./format.ts";
import { isPlainClick, mezesHref, navigate } from "./router.ts";

const Card = ({ mezes }: { readonly mezes: MezesSummary }): ReactElement => {
  const open = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    navigate(mezesHref(mezes.slug));
  };

  return (
    <a className="mz-card" href={mezesHref(mezes.slug)} onClick={open}>
      <h2 className="mz-card-title">
        {/* The design breaks a name across lines on its spaces. */}
        {mezes.name.split(/\s+/).map((word, index) => (
          <span className="mz-word" key={`${word}-${String(index)}`}>
            {word}
          </span>
        ))}
      </h2>
      <span className="mz-card-art">
        <CardArt slug={mezes.slug} />
      </span>
      <span className="mz-card-meta">
        {mezes.visibility} · {plural(mezes.versions.length, "version", "versions")} ·{" "}
        {shortAge(mezes.updatedAt)}
      </span>
    </a>
  );
};

export const Collection = (): ReactElement => {
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [mezedes, setMezedes] = useState<readonly MezesSummary[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    // Typing hits the FTS5 index on every keystroke otherwise.
    const timer = setTimeout(
      () => {
        listMezedes(query)
          .then((found) => {
            if (!current) return;
            setMezedes(found);
            setFailure(null);
          })
          .catch((cause: unknown) => {
            if (current) setFailure(failureText(cause));
          });
      },
      query === "" ? 0 : 180,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, attempt]);

  return (
    <section className="mz-page" aria-label="your mezedes">
      <div className="mz-page-head">
        <h1 className="mz-page-title">your small things</h1>
        <input
          className="mz-search"
          type="search"
          value={query}
          placeholder="search"
          aria-label="Search your mezedes"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
      </div>

      {failure !== null ? (
        <p className="mz-notice mz-notice-bad" role="alert">
          {failure}{" "}
          <button
            type="button"
            className="mz-inline-action"
            onClick={() => {
              setAttempt((count) => count + 1);
            }}
          >
            try again
          </button>
        </p>
      ) : null}

      {mezedes === null && failure === null ? <p className="mz-notice">loading</p> : null}

      {mezedes !== null && mezedes.length === 0 ? (
        <p className="mz-notice">
          {query === ""
            ? "nothing here yet. a mezes appears when an agent creates one."
            : `nothing matches “${query}”.`}
        </p>
      ) : null}

      {mezedes !== null && mezedes.length > 0 ? (
        <div className="mz-grid">
          {mezedes.map((mezes) => (
            <Card key={mezes.slug} mezes={mezes} />
          ))}
        </div>
      ) : null}
    </section>
  );
};
