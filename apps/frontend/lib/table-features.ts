import {
  columnFilteringFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createSortedRowModel,
  filterFns,
  globalFilteringFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
} from "@tanstack/react-table"

/**
 * Feature registry shared by every data table in the app.
 *
 * react-table v9 no longer bundles features automatically, so each table has to
 * opt into the ones it uses. Our tables all do the same thing: sortable
 * headers, a global search box, hideable columns, per-column `size` hints, and
 * the shadcn row `data-state={row.getIsSelected() && "selected"}` markup. The
 * full `filterFns` / `sortFns` registries are registered (rather than
 * individual built-ins) so the `"auto"` sort/filter resolution keeps behaving
 * the way it did under v8.
 */
export const dataTableFeatures = tableFeatures({
  columnFilteringFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  globalFilteringFeature,
  rowSelectionFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns,
  sortFns,
})

export type DataTableFeatures = typeof dataTableFeatures
