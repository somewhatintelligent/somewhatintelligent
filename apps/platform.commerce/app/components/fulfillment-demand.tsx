import { useState } from "react";

import { Button } from "platform.ui/components/button";

import type { FulfillmentDemandDTO } from "../../domain/Contracts.ts";
import { Empty } from "./page.tsx";
import { DataTable, Td, type Column } from "./table.tsx";

type DemandLine = FulfillmentDemandDTO["lines"][number];

const COMMON_SIZES = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "XXL", "3XL", "XXXL", "4XL"];
const SIZE_RANK = new Map(COMMON_SIZES.map((size, index) => [size, index]));

const compareSizes = (left: string, right: string): number => {
  const leftRank = SIZE_RANK.get(left.trim().toUpperCase());
  const rightRank = SIZE_RANK.get(right.trim().toUpperCase());
  if (leftRank !== undefined || rightRank !== undefined) {
    return (leftRank ?? Number.MAX_SAFE_INTEGER) - (rightRank ?? Number.MAX_SAFE_INTEGER);
  }
  return left.localeCompare(right, "en-CA", { numeric: true });
};

const expectedDate = (at: number | null): string =>
  at === null
    ? "Not set"
    : new Date(at).toLocaleDateString("en-CA", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

interface MatrixRow {
  key: string;
  title: string;
  expectedShipAt: number | null;
  quantities: Map<string, number>;
  total: number;
}

/** Turn identity-safe aggregate lines into the product-by-size matrix an operator reads. */
const matrix = (lines: readonly DemandLine[]): { sizes: string[]; rows: MatrixRow[] } => {
  const sizes = [...new Set(lines.map((line) => line.size))].sort(compareSizes);
  const rows = new Map<string, MatrixRow>();

  for (const line of lines) {
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

  return {
    sizes,
    rows: [...rows.values()].sort(
      (left, right) =>
        left.title.localeCompare(right.title, "en-CA") ||
        (left.expectedShipAt ?? Number.MAX_SAFE_INTEGER) -
          (right.expectedShipAt ?? Number.MAX_SAFE_INTEGER),
    ),
  };
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
    const expected =
      row.expectedShipAt === null ? "" : ` · expected ${expectedDate(row.expectedShipAt)}`;
    return `${row.title}${expected}\n${sizes}`;
  });

  return [`Manufacturing demand`, ...blocks, `Total: ${units(lines)} units`].join("\n\n");
};

const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

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
    line.title,
    line.size,
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
  if (demand.rows.length === 0) {
    return (
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        <p className="py-4 text-sm text-muted-foreground">None.</p>
      </div>
    );
  }

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
      <DataTable columns={columns}>
        {demand.rows.map((row) => (
          <tr key={row.key}>
            <Td className="font-medium">{row.title}</Td>
            {showExpected ? (
              <Td className="text-xs text-muted-foreground">{expectedDate(row.expectedShipAt)}</Td>
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
    </div>
  );
}

/**
 * The paid-order read model: pre-order units for the manufacturer, stock units
 * for packing, and no dependence on the paginated order table beneath it.
 */
export function FulfillmentDemandSummary({ demand }: { demand: FulfillmentDemandDTO }) {
  const [copied, setCopied] = useState(false);
  const manufacturing = demand.lines.filter((line) => line.preorder);
  const stock = demand.lines.filter((line) => !line.preorder);

  if (demand.orderCount === 0) {
    return <Empty>Nothing waiting. Every paid order has shipped.</Empty>;
  }

  const copyManufacturing = async () => {
    await navigator.clipboard.writeText(manufacturerText(manufacturing));
    setCopied(true);
  };

  const download = () => {
    const blob = new Blob([demandCsv(demand.lines)], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `fulfillment-demand-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(href);
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

      <DemandTable
        title="To manufacture"
        description={`${units(manufacturing)} pre-order unit${units(manufacturing) === 1 ? "" : "s"} from manufacturing runs.`}
        lines={manufacturing}
        showExpected
      />
      <DemandTable
        title="From stock"
        description={`${units(stock)} physical unit${units(stock) === 1 ? "" : "s"} already allocated from shelf inventory.`}
        lines={stock}
      />
    </div>
  );
}
