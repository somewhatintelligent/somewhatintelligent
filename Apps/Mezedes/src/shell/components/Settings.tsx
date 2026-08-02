import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type RefObject,
} from "react";
import { deleteMezes, failureText, patchMezes, type MezesRecord, type Visibility } from "./api.ts";
import { CloseIcon } from "./icons.tsx";

/**
 * Name and privacy, then a separated delete. Deleting asks a second time and
 * wants the name typed: every version of a mezes goes with it, and the bytes
 * behind them are not recoverable from the shell.
 */

interface SettingsProps {
  readonly open: boolean;
  readonly mezes: MezesRecord;
  readonly onClose: () => void;
  readonly onSaved: (record: MezesRecord) => void;
  readonly onDeleted: () => void;
}

/** Native `dialog` carries the focus trap, the Escape key and the backdrop. */
const useModal = (open: boolean): RefObject<HTMLDialogElement | null> => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);
  return ref;
};

export const Settings = ({
  open,
  mezes,
  onClose,
  onSaved,
  onDeleted,
}: SettingsProps): ReactElement => {
  const [name, setName] = useState(mezes.name);
  const [visibility, setVisibility] = useState<Visibility>(mezes.visibility);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");

  const settings = useModal(open);
  const confirm = useModal(confirming);
  const nameField = useRef<HTMLInputElement>(null);

  // The form is a draft of the record, so it is re-seeded every time it opens.
  useEffect(() => {
    if (!open) return;
    setName(mezes.name);
    setVisibility(mezes.visibility);
    setFailure(null);
    nameField.current?.focus();
  }, [open, mezes]);

  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") {
      setFailure("A mezes needs a name.");
      return;
    }
    setBusy(true);
    setFailure(null);
    patchMezes(mezes.slug, { name: trimmed, visibility })
      .then((record) => {
        onSaved(record);
        onClose();
      })
      .catch((cause: unknown) => {
        setFailure(failureText(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const destroy = (): void => {
    setBusy(true);
    setFailure(null);
    deleteMezes(mezes.slug)
      .then(() => {
        setConfirming(false);
        onDeleted();
      })
      .catch((cause: unknown) => {
        setFailure(failureText(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <>
      <dialog
        className="mz-modal"
        ref={settings}
        onClose={onClose}
        aria-labelledby="mz-settings-title"
      >
        <form onSubmit={save}>
          <div className="mz-modal-head">
            <h2 id="mz-settings-title">mezes settings</h2>
            <button
              type="button"
              className="mz-icon-action"
              onClick={onClose}
              aria-label="Close settings"
            >
              <CloseIcon />
            </button>
          </div>

          <div className="mz-modal-body">
            <div className="mz-field">
              <label htmlFor="mz-name">name</label>
              <input
                id="mz-name"
                ref={nameField}
                type="text"
                value={name}
                autoComplete="off"
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </div>

            <fieldset className="mz-field">
              <legend>privacy</legend>
              <div className="mz-choices">
                {(["private", "public"] as const).map((option) => (
                  <label
                    key={option}
                    className={visibility === option ? "mz-choice is-on" : "mz-choice"}
                  >
                    <input
                      type="radio"
                      name="visibility"
                      value={option}
                      checked={visibility === option}
                      onChange={() => {
                        setVisibility(option);
                      }}
                    />
                    <span>{option === "private" ? "private" : "public internet"}</span>
                  </label>
                ))}
              </div>
              <p className="mz-helper">Public mezedes can be reached by anyone with the link.</p>
            </fieldset>

            {failure === null ? null : (
              <p className="mz-notice mz-notice-bad" role="alert">
                {failure}
              </p>
            )}
          </div>

          <div className="mz-modal-actions">
            <button type="button" className="mz-quiet-action" onClick={onClose}>
              cancel
            </button>
            <button type="submit" className="mz-strong-action" disabled={busy}>
              save changes
            </button>
          </div>

          <div className="mz-modal-danger">
            <button
              type="button"
              className="mz-danger-action"
              onClick={() => {
                setTyped("");
                onClose();
                setConfirming(true);
              }}
            >
              delete mezes
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        className="mz-modal"
        ref={confirm}
        onClose={() => {
          setConfirming(false);
        }}
        aria-labelledby="mz-delete-title"
      >
        <div className="mz-modal-head">
          <h2 id="mz-delete-title">delete mezes?</h2>
          <button
            type="button"
            className="mz-icon-action"
            onClick={() => {
              setConfirming(false);
            }}
            aria-label="Close confirmation"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="mz-modal-body">
          <p className="mz-helper">
            This removes the mezes and every version it has served. Type{" "}
            <strong>{mezes.name}</strong> to continue.
          </p>
          <div className="mz-field">
            <label htmlFor="mz-delete-confirm">mezes name</label>
            <input
              id="mz-delete-confirm"
              type="text"
              value={typed}
              autoComplete="off"
              onChange={(event) => {
                setTyped(event.target.value);
              }}
            />
          </div>
          {failure === null ? null : (
            <p className="mz-notice mz-notice-bad" role="alert">
              {failure}
            </p>
          )}
        </div>

        <div className="mz-modal-actions">
          <button
            type="button"
            className="mz-quiet-action"
            onClick={() => {
              setConfirming(false);
            }}
          >
            cancel
          </button>
          <button
            type="button"
            className="mz-danger-action"
            disabled={busy || typed.trim() !== mezes.name}
            onClick={destroy}
          >
            delete forever
          </button>
        </div>
      </dialog>
    </>
  );
};
