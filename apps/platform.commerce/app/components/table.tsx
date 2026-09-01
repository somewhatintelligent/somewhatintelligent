/**
 * The two shapes every list page here is made of: a status filter that writes
 * to the URL, and a table.
 *
 * Extracted because the catalogue and the order book had rendered the same
 * sixty-five lines of select-plus-table twice, which is the kind of copy that
 * quietly diverges — one page gains a sticky header or a different empty state
 * and nobody notices the other did not.
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "platform.ui/components/select";
import { cn } from "platform.ui/lib/utils";

import { Empty, Section } from "./page.tsx";
import { Outcome } from "./outcome.tsx";

/**
 * A status filter bound to a search param.
 *
 * The value lives in the URL rather than in component state, so a filtered view
 * is a link someone can send and a reload keeps. `onChange` takes the narrowed
 * option rather than a string, so a route cannot wire it to a param the loader
 * does not understand.
 */
interface StatusFilterProps<T extends string> {
  value: T;
  options: readonly T[];
  labels?: Partial<Record<T, string>>;
  onChange: (value: T) => void;
}

function StatusFilter<T extends string>({
  value,
  options,
  labels,
  onChange,
}: StatusFilterProps<T>) {
  const label = (option: T): string => labels?.[option] ?? option;
  return (
    <Select value={value} onValueChange={(next) => next && onChange(next as T)}>
      <SelectTrigger className="w-40">
        {/* A function child, because the collapsed trigger otherwise stringifies the raw
            value and shows `paid` under a list that says `ready to ship`. */}
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {label(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface Column {
  label: string;
  /** Numbers read down a column; everything else reads across. */
  align?: "right";
}

/**
 * A table that scrolls sideways rather than forcing the page to.
 *
 * `columns` is a list rather than markup so a header cell cannot pick up
 * styling one page has and another does not — the alignment of a money column
 * is stated once, here, and applies to every page that declares one.
 */
export function DataTable({
  columns,
  children,
}: {
  columns: readonly Column[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs tracking-wide text-muted-foreground uppercase">
            {columns.map((column, index) => (
              <th
                key={column.label || `col-${index}`}
                className={cn(
                  "py-2 font-medium",
                  index < columns.length - 1 && "pr-3",
                  column.align === "right" && "text-right",
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

/**
 * A FILTERED LIST OF RECORDS — the whole shape of the catalogue and the order
 * book, which are the same page twice.
 *
 * It owns the three states a read has, so neither page can grow one the other
 * lacks: the domain REFUSED (rendered as what it said, not as an empty table),
 * the read succeeded and found nothing, and the read found rows. The first two
 * had already started to differ before this was extracted.
 */
export function RecordList<S extends string>({
  title,
  description,
  filter,
  refusal,
  columns,
  empty,
  isEmpty,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  filter: StatusFilterProps<S>;
  /** The domain's refusal text, or `null` when the read succeeded. */
  refusal: string | null;
  columns: readonly Column[];
  empty: React.ReactNode;
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  return (
    <Section title={title} description={description} actions={<StatusFilter {...filter} />}>
      {refusal !== null ? (
        <Outcome error={new Error(refusal)} />
      ) : isEmpty ? (
        <Empty>{empty}</Empty>
      ) : (
        <DataTable columns={columns}>{children}</DataTable>
      )}
    </Section>
  );
}

/** A body cell. `right` also switches on tabular figures, because it is a number. */
export function Td({
  align,
  className,
  children,
  colSpan,
}: {
  align?: "right";
  className?: string;
  children?: React.ReactNode;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn("py-2 pr-3", align === "right" && "tnum text-right", className)}
    >
      {children}
    </td>
  );
}
