/**
 * Page furniture. Layout only — nothing here knows what commerce is.
 */
import { cn } from "platform.ui/lib/utils";

export function PageHeader({
  back,
  title,
  badges,
  subtitle,
  actions,
}: {
  /** Where the back chevron goes. Absent on a list page, which has nowhere up. */
  back?: React.ReactNode;
  title: React.ReactNode;
  /** Status and version — facts that belong BESIDE a name rather than under it. */
  badges?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-3">
          {back}
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {badges ? <div className="flex shrink-0 items-center gap-2">{badges}</div> : null}
        </div>
        {subtitle ? <div className="text-sm text-muted-foreground">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        // `self-start` so a panel is as tall as its content. Stretched to fill a
        // grid row, a one-row table left a screenful of dead space under it.
        "self-start rounded-xl border border-border bg-card p-5",
        className,
      )}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A definition list of small facts — the shape every detail panel here uses. */
export function Facts({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="tnum text-right sm:text-left">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}
