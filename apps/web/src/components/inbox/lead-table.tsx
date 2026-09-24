"use client";

import {
  type ColumnDef,
  type ExpandedState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  type OnChangeFn,
  type Row,
  type RowSelectionState,
  useReactTable,
} from "@tanstack/react-table";
import type { ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { LeadSummary } from "@/lib/types";

// Dumb table: receives data, columns and state; the view above owns fetching and mutations.
// Sorting is server-side (the list is paginated), so no client sorting model here.

export interface LeadTableProps {
  data: LeadSummary[];
  columns: ColumnDef<LeadSummary>[];
  expanded: ExpandedState;
  onExpandedChange: OnChangeFn<ExpandedState>;
  rowSelection: RowSelectionState;
  onRowSelectionChange: OnChangeFn<RowSelectionState>;
  activeId: string | null;
  onRowClick: (row: Row<LeadSummary>, event: React.MouseEvent) => void;
  renderExpanded: (row: Row<LeadSummary>) => ReactNode;
}

export function rowDomId(leadId: string): string {
  return `lead-row-${leadId}`;
}

export function LeadTable({
  data,
  columns,
  expanded,
  onExpandedChange,
  rowSelection,
  onRowSelectionChange,
  activeId,
  onRowClick,
  renderExpanded,
}: LeadTableProps) {
  const table = useReactTable({
    data,
    columns,
    state: { expanded, rowSelection },
    onExpandedChange,
    onRowSelectionChange,
    enableRowSelection: true,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => true,
    manualSorting: true,
  });

  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((hg) => (
          <TableRow key={hg.id} className="hover:bg-transparent">
            {hg.headers.map((h) => (
              <TableHead key={h.id} style={{ width: h.getSize() !== 150 ? h.getSize() : undefined }}>
                {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <RowGroup
            key={row.id}
            row={row}
            active={row.id === activeId}
            columnCount={columns.length}
            onRowClick={onRowClick}
            renderExpanded={renderExpanded}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function RowGroup({
  row,
  active,
  columnCount,
  onRowClick,
  renderExpanded,
}: {
  row: Row<LeadSummary>;
  active: boolean;
  columnCount: number;
  onRowClick: LeadTableProps["onRowClick"];
  renderExpanded: LeadTableProps["renderExpanded"];
}) {
  return (
    <>
      <TableRow
        id={rowDomId(row.id)}
        data-active={active || undefined}
        data-state={row.getIsSelected() ? "selected" : undefined}
        aria-expanded={row.getIsExpanded()}
        className="cursor-pointer"
        onClick={(e) => onRowClick(row, e)}
      >
        {row.getVisibleCells().map((cell) => (
          <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
        ))}
      </TableRow>
      {row.getIsExpanded() ? (
        <TableRow className="bg-muted/40 hover:bg-muted/40">
          <TableCell colSpan={columnCount} className="h-auto whitespace-normal px-4 py-3">
            {renderExpanded(row)}
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
