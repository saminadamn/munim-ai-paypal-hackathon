'use client';

// The AG Grid Munim's pages use: the boilerplate's theme plus cell editing, cell styles and
// tooltips. Columns may carry functions here because the callers are client components.

import {
  ClientSideRowModelModule,
  CellStyleModule,
  ColumnAutoSizeModule,
  NumberEditorModule,
  NumberFilterModule,
  QuickFilterModule,
  SelectEditorModule,
  TextEditorModule,
  TextFilterModule,
  TooltipModule,
  themeQuartz,
  type ColDef,
  type GridOptions,
} from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';

const modules = [
  ClientSideRowModelModule,
  CellStyleModule,
  ColumnAutoSizeModule,
  NumberEditorModule,
  NumberFilterModule,
  QuickFilterModule,
  SelectEditorModule,
  TextEditorModule,
  TextFilterModule,
  TooltipModule,
];

export const munimTheme = themeQuartz.withParams({
  fontFamily: 'var(--pp-font)',
  accentColor: 'var(--pp-blue)',
  foregroundColor: 'var(--pp-ink)',
  borderColor: 'var(--pp-border)',
  headerFontWeight: 600,
  headerTextColor: 'var(--pp-muted)',
  rowHoverColor: 'var(--pp-highlight)',
  wrapperBorderRadius: 8,
});

export function MunimGrid<T>({ rows, columns, height = 360, ...rest }: { rows: T[]; columns: ColDef<T>[]; height?: number | string } & GridOptions<T>) {
  return (
    <div style={{ height }}>
      <AgGridProvider modules={modules}>
        <AgGridReact<T>
          theme={munimTheme}
          rowData={rows}
          columnDefs={columns}
          defaultColDef={{ sortable: true, resizable: true }}
          enableCellTextSelection
          tooltipShowDelay={300}
          {...rest}
        />
      </AgGridProvider>
    </div>
  );
}
