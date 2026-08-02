import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { failureText, getMezes, type MezesDetail, type MezesRecord } from "./api.ts";
import { CodeView } from "./CodeView.tsx";
import { ExternalIcon, GearIcon } from "./icons.tsx";
import { Preview } from "./Preview.tsx";
import { navigate } from "./router.ts";
import { Settings } from "./Settings.tsx";
import { Versions } from "./Versions.tsx";

interface MezesProps {
  readonly slug: string;
  /** Reported upward for the header crumb, and cleared while the next one loads. */
  readonly onName: (name: string | null) => void;
  /**
   * The header's trailing slot. Everything that would have been a second bar —
   * the view toggle, versions, settings — lives behind one gear up there, so
   * the workspace below gets the whole viewport.
   */
  readonly slot: HTMLElement | null;
}

export const Mezes = ({ slug, onName, slot }: MezesProps): ReactElement => {
  const [detail, setDetail] = useState<MezesDetail | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [version, setVersion] = useState<number | null>(null);
  const [sheet, setSheet] = useState(false);
  const [settings, setSettings] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuWrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let current = true;
    setDetail(null);
    setFailure(null);
    setVersion(null);
    setTab("preview");
    onName(null);
    getMezes(slug)
      .then((found) => {
        if (!current) return;
        setDetail(found);
        onName(found.name);
      })
      .catch((cause: unknown) => {
        if (current) setFailure(failureText(cause));
      });
    return () => {
      current = false;
    };
  }, [slug, onName]);

  useEffect(() => {
    if (!menu) return undefined;
    // Anything outside the menu closes it. The trigger is inside, so its own
    // click still toggles rather than closing and reopening in one gesture.
    const dismiss = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && menuWrap.current?.contains(target) === true) return;
      setMenu(false);
    };
    globalThis.addEventListener("pointerdown", dismiss);
    return () => {
      globalThis.removeEventListener("pointerdown", dismiss);
    };
  }, [menu]);

  if (detail === null) {
    return (
      <section className="mz-detail mz-detail-bare">
        <p className={failure === null ? "mz-notice" : "mz-notice mz-notice-bad"} role="status">
          {failure ?? "loading"}
        </p>
      </section>
    );
  }

  const active = version ?? detail.head;

  return (
    <section className="mz-detail" aria-label={detail.name}>
      {slot === null
        ? null
        : createPortal(
            <span className="mz-menu-wrap" ref={menuWrap}>
              <button
                type="button"
                className="mz-icon-action"
                aria-label="Mezes actions"
                aria-expanded={menu}
                onClick={() => {
                  setMenu((shown) => !shown);
                }}
              >
                <GearIcon />
              </button>
              {menu ? (
                <span className="mz-menu">
                  <span className="mz-menu-label">view</span>
                  {(["preview", "code"] as const).map((mode) => (
                    <button
                      type="button"
                      key={mode}
                      aria-current={tab === mode}
                      onClick={() => {
                        setTab(mode);
                        setMenu(false);
                      }}
                    >
                      {mode}
                    </button>
                  ))}

                  <span className="mz-menu-rule" aria-hidden="true" />

                  <button
                    type="button"
                    onClick={() => {
                      setMenu(false);
                      setSheet(true);
                    }}
                  >
                    versions{version === null ? "" : ` · v${String(version)}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(false);
                      setSettings(true);
                    }}
                  >
                    settings
                  </button>

                  {/* A private mezes has no public URL at all, so the action is
                      absent rather than disabled. The mark says it leaves. */}
                  {detail.visibility === "public" ? (
                    <a
                      href={detail.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      onClick={() => {
                        setMenu(false);
                      }}
                    >
                      open live
                      <ExternalIcon size={15} />
                    </a>
                  ) : null}
                </span>
              ) : null}
            </span>,
            slot,
          )}

      <div className="mz-workspace">
        {tab === "preview" ? (
          <Preview slug={detail.slug} name={detail.name} version={active} />
        ) : (
          <CodeView slug={detail.slug} version={active} />
        )}
      </div>

      <Versions
        open={sheet}
        slug={detail.slug}
        head={detail.head}
        versions={detail.versions}
        selected={version}
        onSelect={(next) => {
          setVersion(next === detail.head ? null : next);
          setSheet(false);
        }}
        onClose={() => {
          setSheet(false);
        }}
      />

      <Settings
        open={settings}
        mezes={detail}
        onClose={() => {
          setSettings(false);
        }}
        onSaved={(record: MezesRecord) => {
          setDetail((current) => (current === null ? null : { ...current, ...record }));
          onName(record.name);
        }}
        onDeleted={() => {
          navigate("/");
        }}
      />
    </section>
  );
};
