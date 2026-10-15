//! 首启导入命令。

use tauri::State;

use crate::services::cc_switch::{self, DiscoveredProvider, ImportRequest, ImportResult};
use crate::services::import::{self, ImportedProvider};
use crate::state::AppState;

#[tauri::command]
pub fn import_existing(state: State<'_, AppState>) -> Result<Vec<ImportedProvider>, String> {
    import::import_existing(&state.db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scan_cc_switch_providers(
    state: State<'_, AppState>,
) -> Result<Vec<DiscoveredProvider>, String> {
    cc_switch::discover(&state.db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_cc_switch_providers(
    state: State<'_, AppState>,
    requests: Vec<ImportRequest>,
) -> Result<ImportResult, String> {
    cc_switch::import_selected(&state.db, &requests).map_err(|e| e.to_string())
}
