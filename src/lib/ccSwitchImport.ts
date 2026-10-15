export type CcSwitchImportFilter = "all" | string;

export interface CcSwitchSelectionItem {
  source_id: string;
  app_type: string;
  importable: boolean;
}

export function ccSwitchItemKey(item: Pick<CcSwitchSelectionItem, "source_id" | "app_type">): string {
  return `${item.app_type}:${item.source_id}`;
}

export function selectionForFilter(
  items: CcSwitchSelectionItem[],
  filter: CcSwitchImportFilter,
): Set<string> {
  return new Set(
    items
      .filter((item) => item.importable && (filter === "all" || item.app_type === filter))
      .map(ccSwitchItemKey),
  );
}
