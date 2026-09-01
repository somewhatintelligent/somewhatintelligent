import { useState } from "react";

import { Button } from "platform.ui/components/button";

import { sortBySize } from "../../core/money.ts";
import type { FulfillmentDemandDTO } from "../../domain/Contracts.ts";
import { when } from "../lib/format.ts";
import { Outcome } from "./outcome.tsx";
import { Empty } from "./page.tsx";
import { DataTable, Td, type Column } from "./table.tsx";

type DemandLine = FulfillmentDemandDTO["lines"][number];

interface MatrixRow {
  key: string;
  title: string;
  expectedShipAt: number | null;
  quantities: Map<string, number>;
  total: number;
}

/** Turn identity-safe aggregate lines into the product-by-size matrix an operator reads. */
const matrix = (lines: readonly DemandLine[]): { sizes: string[]; rows: MatrixRow[] } => {
  // The garment scale from `core/money.ts`, so a column here sits where the
  // catalog and the storefront already put it.
  const sizes = [...new Set(sortBySize(lines).map((line) => line.size))];
  const rows = new Map<string, MatrixRow>();

  for (const line of lines) {
    // No `preorder` in the key: both callers split on it before grouping, and a
    // mixed list would merge a stock row into a manufacturing one.
    const key = `${line.productId}\u0000${line.title}\u0000${line.expectedShipAt ?? "none"}`;
    const row = rows.get(key) ?? {
      key,
      title: line.title,
      expectedShipAt: line.expectedShipAt,
      quantities: new Map<string, number>(),
      total: 0,
    };
    row.quantities.set(line.size, (row.quantities.get(line.size) ?? 0) + line.quantity);
    row.total += line.quantity;
    rows.set(key, row);
  }

  // Row order is the aggregate's — title, then expected date, within one
  // pre-order class — and grouping keeps first appearance, so there is no
  // second ordering here to drift from the domain's.
  return { sizes, rows: [...rows.values()] };
};

const units = (lines: readonly DemandLine[]): number =>
  lines.reduce((total, line) => total + line.quantity, 0);

/** Plain text shaped for pasting into a manufacturer message. */
const manufacturerText = (lines: readonly DemandLine[]): string => {
  const demand = matrix(lines);
  const blocks = demand.rows.map((row) => {
    const sizes = demand.sizes
      .map((size) => [size, row.quantities.get(size) ?? 0] as const)
      .filter(([, quantity]) => quantity > 0)
      .map(([size, quantity]) => `${size}: ${quantity}`)
      .join("\n");
    const expected = row.expectedShipAt === null ? "" : ` · expected ${when(row.expectedShipAt)}`;
    return `${row.title}${expected}\n${sizes}`;
  });

  return [`Manufacturing demand`, ...blocks, `Total: ${units(lines)} units`].join("\n\n");
};

/** A lone `\r` frames a new record for an RFC 4180 reader, so it quotes like `\n` does. */
const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/**
 * Free text, defused.
 *
 * Titles and sizes are whatever the operator typed — `minLength(1)` and nothing
 * else — and a cell opening with `=`, `+`, `-` or `@` is a FORMULA to Excel and
 * Sheets, evaluated on open. The leading apostrophe is the spreadsheet's own
 * escape for "this is text"; it stays off the numeric columns so quantity
 * arrives as a number.
 */
const csvText = (value: string): string => (/^[=+\-@]/.test(value) ? `'${value}` : value);

const demandCsv = (lines: readonly DemandLine[]): string => {
  const header = [
    "category",
    "product_id",
    "variant_id",
    "product",
    "size",
    "quantity",
    "expected_ship_at",
  ];
  const rows = lines.map((line) => [
    line.preorder ? "manufacture" : "stock",
    line.productId,
    line.variantId,
    csvText(line.title),
    csvText(line.size),
    line.quantity,
    line.expectedShipAt === null ? "" : new Date(line.expectedShipAt).toISOString(),
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
};

function DemandTable({
  title,
  description,
  lines,
  showExpected,
}: {
  title: string;
  description: string;
  lines: readonly DemandLine[];
  showExpected?: boolean;
}) {
  const demand = matrix(lines);
  const columns: Column[] = [
    { label: "Product" },
    ...(showExpected ? [{ label: "Expected" }] : []),
    ...demand.sizes.map((size) => ({ label: size, align: "right" as const })),
    { label: "Total", align: "right" },
  ];

  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-0.5 mb-2 text-xs text-muted-foreground">{description}</p>
      {demand.rows.length === 0 ? (
        <Empty>None.</Empty>
      ) : (
        <DataTable columns={columns}>
          {demand.rows.map((row) => (
            <tr key={row.key}>
              <Td className="font-medium">{row.title}</Td>
              {showExpected ? (
                <Td className="text-xs text-muted-foreground">{when(row.expectedShipAt)}</Td>
              ) : null}
              {demand.sizes.map((size) => {
                const quantity = row.quantities.get(size) ?? 0;
                return (
                  <Td
                    key={size}
                    align="right"
                    className={quantity === 0 ? "text-muted-foreground" : undefined}
                  >
                    {quantity === 0 ? "—" : quantity}
                  </Td>
                );
              })}
              <Td align="right" className="font-semibold">
                {row.total}
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}

/**
 * The aggregate is the ONLY honest source for the ready-to-ship numbers. Any
 * order list beside it is a capped window, so standing one in would print a
 * plausible number over the real one — exactly the undercount
 * `Orders.fulfillmentDemand` exists to prevent. When the aggregate does not
 * arrive, the demand is unknown and every page that renders this says so, in
 * these words.
 */
const DEMAND_UNREADABLE =
  "The fulfilment demand read failed, so the number of paid, unshipped orders is unknown. Anything listed below is a capped window, not the whole queue — reload to try again.";

/**
 * The paid-order read model: pre-order units for the manufacturer, stock units
 * for packing, and no dependence on the paginated order table beneath it.
 *
 * Owns all three states of the read — unreadable, nothing waiting, and the
 * matrices — so no route can render the same `null` two different ways.
 */
export function FulfillmentDemandSummary({ demand }: { demand: FulfillmentDemandDTO | null }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The RPC declares no error channel, so the loaders catch a rejection to
  // `null`: a read that FAILED, never a demand of zero.
  if (demand === null) {
    return <Outcome error={DEMAND_UNREADABLE} />;
  }
  if (demand.orderCount === 0) {
    return <Empty>Nothing waiting. Every paid order has shipped.</Empty>;
  }

  const manufacturing = demand.lines.filter((line) => line.preorder);
  const stock = demand.lines.filter((line) => !line.preorder);
  const manufacturingUnits = units(manufacturing);
  const stockUnits = units(stock);

  /**
   * A clipboard write is a PERMISSION, not a certainty — an insecure origin or a
   * denied prompt rejects it — and the label has to fall back so it never claims
   * a copy the operator did not get, here or after the loader revalidates.
   */
  const copyManufacturing = async () => {
    try {
      await navigator.clipboard.writeText(manufacturerText(manufacturing));
      setError(null);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (cause) {
      setCopied(false);
      const detail = cause instanceof Error ? cause.message : String(cause);
      setError(`The clipboard refused the copy (${detail}). Download the CSV instead.`);
    }
  };

  const download = () => {
    const blob = new Blob([demandCsv(demand.lines)], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `fulfillment-demand-${new Date().toISOString().slice(0, 10)}.csv`;
    // `appendChild`, not `append`: `@cloudflare/workers-types` merges its own
    // HTMLRewriter `Element` into the DOM one and takes that name over.
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // The click only QUEUES the download, so the object URL has to outlive this
    // frame — revoking inline races the fetch that reads it.
    setTimeout(() => URL.revokeObjectURL(href), 0);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">
          <strong className="tnum">{demand.orderCount}</strong> paid order
          {demand.orderCount === 1 ? "" : "s"} ·{" "}
          <strong className="tnum">{demand.unitCount}</strong> unit
          {demand.unitCount === 1 ? "" : "s"}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={manufacturing.length === 0}
            onClick={() => void copyManufacturing()}
          >
            {copied ? "Copied" : "Copy manufacturing"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={download}>
            Download CSV
          </Button>
        </div>
      </div>

      <Outcome error={error} />

      <DemandTable
        title="To manufacture"
        description={`${manufacturingUnits} pre-order unit${manufacturingUnits === 1 ? "" : "s"} from manufacturing runs.`}
        lines={manufacturing}
        showExpected
      />
      <DemandTable
        title="From stock"
        description={`${stockUnits} physical unit${stockUnits === 1 ? "" : "s"} already allocated from shelf inventory.`}
        lines={stock}
      />
    </div>
  );
}
