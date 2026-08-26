use std::collections::HashSet;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::{
    Router,
    body::Body,
    extract::{Query, State, WebSocketUpgrade, ws::{Message, WebSocket}},
    http::{StatusCode, header},
    response::{IntoResponse, Json},
    routing::{get, post, put},
};
use fleetfile_core::{ConflictInfo, DriveInfo, Entry, TextFile, UserDirs};
use futures_util::{SinkExt, StreamExt};
use notify::Watcher;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tower_http::services::{ServeDir, ServeFile};

mod pty;
mod settings;

// ── Shared state ───────────────────────────────────────────────────────────

type EventTx = tokio::sync::broadcast::Sender<String>;

#[derive(Clone)]
struct AppState {
    /// Broadcast of JSON event strings pushed to all WebSocket clients.
    events: EventTx,
    /// Directory watcher + set of watched paths.
    watch: Arc<WatchHub>,
    /// Operation ids the client asked to cancel.
    cancels: Arc<Mutex<HashSet<String>>>,
    op_counter: Arc<AtomicU64>,
    /// PTY sessions for the terminal.
    pty_hub: pty::PtyHub,
    /// Persistent preferences (per-folder view settings, folder colors).
    prefs: Arc<settings::SettingsStore>,
}

struct WatchHub {
    watcher: tokio::sync::Mutex<Option<notify::RecommendedWatcher>>,
    watched: tokio::sync::Mutex<HashSet<String>>,
}

impl WatchHub {
    fn new(events: EventTx) -> Self {
        let (evt_tx, mut evt_rx) = tokio::sync::mpsc::unbounded_channel::<notify::Event>();
        let watcher = notify::recommended_watcher(
            move |res: Result<notify::Event, notify::Error>| {
                if let Ok(ev) = res {
                    let _ = evt_tx.send(ev);
                }
            },
        )
        .expect("failed to create file watcher");

        // Debounced relay: one dir-changed event per directory per ~250ms window.
        let fwd = events.clone();
        tokio::spawn(async move {
            let mut pending: std::collections::HashMap<String, tokio::task::JoinHandle<()>> =
                std::collections::HashMap::new();
            while let Some(ev) = evt_rx.recv().await {
                let Some(p) = ev.paths.first() else { continue };
                let dir = if p.is_dir() {
                    p.clone()
                } else {
                    p.parent()
                        .map(|x| x.to_path_buf())
                        .unwrap_or_else(|| p.clone())
                };
                let key = normalize_path(&dir.to_string_lossy());
                if pending.contains_key(&key) {
                    continue;
                }
                let tx = fwd.clone();
                let k = key.clone();
                let handle = tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(250)).await;
                    let _ = tx.send(json!({"type":"dir-changed","path": k}).to_string());
                });
                pending.insert(key, handle);
                pending.retain(|_, h| !h.is_finished());
            }
        });

        Self {
            watcher: tokio::sync::Mutex::new(Some(watcher)),
            watched: tokio::sync::Mutex::new(HashSet::new()),
        }
    }

    async fn watch(&self, path: &str) {
        let key = normalize_path(path);
        {
            let mut seen = self.watched.lock().await;
            if !seen.insert(key.clone()) {
                return;
            }
        }
        let mut guard = self.watcher.lock().await;
        if let Some(w) = guard.as_mut() {
            if let Err(e) = w.watch(Path::new(path), notify::RecursiveMode::NonRecursive) {
                eprintln!("[watch] watch({}) failed: {}", path, e);
            }
        }
    }

    async fn unwatch(&self, path: &str) {
        let key = normalize_path(path);
        {
            let mut seen = self.watched.lock().await;
            if !seen.remove(&key) {
                return;
            }
        }
        let mut guard = self.watcher.lock().await;
        if let Some(w) = guard.as_mut() {
            let _ = w.unwatch(Path::new(path));
        }
    }
}

fn normalize_path(p: &str) -> String {
    p.replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

fn next_op_id(state: &AppState) -> String {
    let n = state.op_counter.fetch_add(1, Ordering::Relaxed);
    format!("op-{}", n)
}

// ── Request / response types ───────────────────────────────────────────────

#[derive(Deserialize)]
struct PathQuery {
    path: String,
}

#[derive(Deserialize)]
struct CopyMoveRequest {
    source: String,
    destination: String,
    /// Optional shared operation id (client batch). Omit to let the server generate one.
    op: Option<String>,
}

#[derive(Deserialize)]
struct RenameRequest {
    old_path: String,
    new_path: String,
}

#[derive(Deserialize)]
struct DeleteRequest {
    path: String,
    to_trash: bool,
}

#[derive(Deserialize)]
struct CreateRequest {
    path: String,
}

#[derive(Deserialize)]
struct ConflictRequest {
    sources: Vec<String>,
    destination_dir: String,
}

#[derive(Deserialize)]
struct RenameDestRequest {
    destination_dir: String,
    file_name: String,
}

#[derive(Deserialize)]
struct SearchRequest {
    path: String,
    q: String,
    limit: Option<usize>,
}

#[derive(Deserialize)]
struct TrashIdRequest {
    id: String,
}

#[derive(Deserialize)]
struct TrashPathRequest {
    path: String,
}

#[derive(Deserialize)]
struct ThumbQuery {
    path: String,
    size: Option<u32>,
}

#[derive(Deserialize)]
struct BulkRenameRequest {
    dir: String,
    files: Vec<String>,
    rules: fleetfile_core::BulkRenameRules,
    dry_run: Option<bool>,
}

#[derive(Deserialize)]
struct WriteTextRequest {
    path: String,
    content: String,
}

#[derive(Deserialize)]
struct CompressRequest {
    sources: Vec<String>,
    destination: String,
    format: String,
    level: Option<u32>,
}

#[derive(Deserialize)]
struct ExtractRequest {
    archive: String,
    destination: String,
    password: Option<String>,
}

#[derive(Deserialize)]
struct HashQuery {
    path: String,
    algo: Option<String>,
}

#[derive(Deserialize)]
struct FolderCompareRequest {
    left: String,
    right: String,
}

#[derive(Deserialize)]
struct DuplicatesRequest {
    dir: String,
    min_size: Option<u64>,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

type AppResult = Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)>;

fn err(e: impl std::fmt::Display) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse { error: e.to_string() }),
    )
}

// ── Progress-aware copy / move ─────────────────────────────────────────────

#[derive(Debug)]
struct ProgressMsg {
    op: String,
    done: u64,
    total: u64,
}

async fn copy_or_move(
    state: AppState,
    source: String,
    destination: String,
    op: Option<String>,
    is_move: bool,
) -> AppResult {
    let op = op.unwrap_or_else(|| next_op_id(&state));
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<ProgressMsg>();
    let events_tx = state.events.clone();
    let cancels = state.cancels.clone();
    let op_id = op.clone();

    let task = tokio::task::spawn_blocking(move || {
        let mut cb = |done: u64, total: u64| {
            if cancels.lock().unwrap().contains(&op_id) {
                return false;
            }
            let _ = tx.send(ProgressMsg {
                op: op_id.clone(),
                done,
                total,
            });
            true
        };
        if is_move {
            fleetfile_core::move_entry_with_progress(&source, &destination, Some(&mut cb))
        } else {
            fleetfile_core::copy_entry_with_progress(&source, &destination, Some(&mut cb))
        }
    });

    let fwd_events = events_tx.clone();
    let fwd_task = tokio::spawn(async move {
        while let Some(m) = rx.recv().await {
            let _ = fwd_events.send(
                json!({"type":"progress","op":m.op,"done":m.done,"total":m.total}).to_string(),
            );
        }
    });

    let join_result = task.await.map_err(|e| err(e))?;
    let _ = fwd_task.await;

    match join_result {
        Ok(()) => {
            let _ = events_tx.send(json!({"type":"op-done","op":op}).to_string());
            Ok(Json(serde_json::json!(null)))
        }
        Err(e) => {
            let cancelled = state.cancels.lock().unwrap().remove(&op);
            let payload =
                json!({"type":"op-error","op":op,"error":e.to_string(),"cancelled":cancelled});
            let _ = events_tx.send(payload.to_string());
            if cancelled {
                // Treat a user-cancelled operation as a graceful no-op response.
                Ok(Json(serde_json::json!(null)))
            } else {
                Err(err(e))
            }
        }
    }
}

// ── REST handlers ──────────────────────────────────────────────────────────

async fn read_dir(Query(q): Query<PathQuery>) -> Result<Json<Vec<Entry>>, (StatusCode, Json<ErrorResponse>)> {
    fleetfile_core::read_dir(&q.path).map(Json).map_err(err)
}

async fn list_drives() -> Json<Vec<DriveInfo>> {
    Json(fleetfile_core::list_drives())
}

async fn user_dirs() -> Result<Json<UserDirs>, (StatusCode, Json<ErrorResponse>)> {
    fleetfile_core::user_dirs().map(Json).map_err(err)
}

async fn copy_entry(State(state): State<AppState>, Json(req): Json<CopyMoveRequest>) -> AppResult {
    copy_or_move(state, req.source, req.destination, req.op, false).await
}

async fn move_entry(State(state): State<AppState>, Json(req): Json<CopyMoveRequest>) -> AppResult {
    copy_or_move(state, req.source, req.destination, req.op, true).await
}

async fn rename_entry(Json(req): Json<RenameRequest>) -> AppResult {
    tokio::task::spawn_blocking(move || fleetfile_core::rename_entry(&req.old_path, &req.new_path))
        .await
        .map_err(|e| err(e))?
        .map_err(err)?;
    Ok(Json(serde_json::json!(null)))
}

async fn delete_entry(Json(req): Json<DeleteRequest>) -> AppResult {
    let path = req.path;
    let to_trash = req.to_trash;
    tokio::task::spawn_blocking(move || fleetfile_core::delete_entry(&path, to_trash))
        .await
        .map_err(|e| err(e))?
        .map_err(err)?;
    Ok(Json(serde_json::json!(null)))
}

async fn create_file(Json(req): Json<CreateRequest>) -> AppResult {
    tokio::task::spawn_blocking(move || fleetfile_core::create_file(&req.path))
        .await
        .map_err(|e| err(e))?
        .map_err(err)?;
    Ok(Json(serde_json::json!(null)))
}

async fn create_dir(Json(req): Json<CreateRequest>) -> AppResult {
    tokio::task::spawn_blocking(move || fleetfile_core::create_dir(&req.path))
        .await
        .map_err(|e| err(e))?
        .map_err(err)?;
    Ok(Json(serde_json::json!(null)))
}

async fn check_conflicts(Json(req): Json<ConflictRequest>) -> Result<Json<Vec<ConflictInfo>>, (StatusCode, Json<ErrorResponse>)> {
    let sources = req.sources;
    let destination_dir = req.destination_dir;
    tokio::task::spawn_blocking(move || fleetfile_core::check_conflicts(&sources, &destination_dir))
        .await
        .map_err(|e| err(e))?
        .map(Json)
        .map_err(err)
}

async fn get_rename_destination(Json(req): Json<RenameDestRequest>) -> Result<Json<String>, (StatusCode, Json<ErrorResponse>)> {
    let destination_dir = req.destination_dir;
    let file_name = req.file_name;
    tokio::task::spawn_blocking(move || {
        fleetfile_core::generate_rename_destination(Path::new(&destination_dir), &file_name)
    })
    .await
    .map_err(|e| err(e))?
    .map(Json)
    .map_err(err)
}

async fn read_text_file(Query(q): Query<PathQuery>) -> Result<Json<TextFile>, (StatusCode, Json<ErrorResponse>)> {
    let path = q.path;
    tokio::task::spawn_blocking(move || fleetfile_core::read_text_file(&path))
        .await
        .map_err(|e| err(e))?
        .map(Json)
        .map_err(err)
}

async fn get_properties(Query(q): Query<PathQuery>) -> Result<Json<fleetfile_core::FileProperties>, (StatusCode, Json<ErrorResponse>)> {
    let path = q.path;
    tokio::task::spawn_blocking(move || fleetfile_core::get_properties(&path))
        .await
        .map_err(|e| err(e))?
        .map(Json)
        .map_err(err)
}

async fn search_files(Query(q): Query<SearchRequest>) -> Result<Json<Vec<Entry>>, (StatusCode, Json<ErrorResponse>)> {
    let path = q.path;
    let query = q.q;
    let limit = q.limit.unwrap_or(200);
    tokio::task::spawn_blocking(move || fleetfile_core::search_files(&path, &query, limit))
        .await
        .map_err(|e| err(e))?
        .map(Json)
        .map_err(err)
}

async fn list_trash() -> Result<Json<Vec<fleetfile_core::TrashItemInfo>>, (StatusCode, Json<ErrorResponse>)> {
    tokio::task::spawn_blocking(fleetfile_core::list_trash)
        .await
        .map_err(|e| err(e))?
        .map(Json)
        .map_err(err)
}

async fn restore_trash(Json(req): Json<TrashIdRequest>) -> AppResult {
    let id = req.id;
    tokio::task::spawn_blocking(move || fleetfile_core::restore_trash_item(&id))
        .await
        .map_err(|e| err(e))?
        .map_err(err)?;
    Ok(Json(serde_json::json!(null)))
}

async fn purge_trash(Json(req): Json<TrashIdRequest>) -> AppResult {
    let id = req.id;
    tokio::task::spawn_blocking(move || fleetfile_core::purge_trash_item(&id))
        .await
        .map_err(|e| err(e))?
        .map_err(err)?;
    Ok(Json(serde_json::json!(null)))
}

async fn empty_trash() -> AppResult {
    tokio::task::spawn_blocking(fleetfile_core::empty_trash)
        .await
        .map_err(|e| err(e))?
        .map_err(err)?;
    Ok(Json(serde_json::json!(null)))
}

async fn restore_trash_by_path(Json(req): Json<TrashPathRequest>) -> AppResult {
    let path = req.path;
    tokio::task::spawn_blocking(move || fleetfile_core::restore_trash_item_by_original(&path))
        .await
        .map_err(|e| err(e))?
        .map_err(err)?;
    Ok(Json(serde_json::json!(null)))
}

async fn thumbnail(
    Query(q): Query<ThumbQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let path = q.path;
    let size = q.size.unwrap_or(128);
    let bytes = tokio::task::spawn_blocking(move || fleetfile_core::make_thumbnail(&path, size))
        .await
        .map_err(|e| err(e))?
        .map_err(err)?;
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "image/png")],
        bytes,
    ))
}

async fn bulk_rename(
    Json(req): Json<BulkRenameRequest>,
) -> Result<Json<Vec<fleetfile_core::BulkRenameResult>>, (StatusCode, Json<ErrorResponse>)> {
    let dir = req.dir;
    let files = req.files;
    let rules = req.rules;
    let dry_run = req.dry_run.unwrap_or(false);
    tokio::task::spawn_blocking(move || {
        fleetfile_core::bulk_rename(&dir, &files, &rules, dry_run)
    })
    .await
    .map_err(|e| err(e))?
    .map(Json)
    .map_err(err)
}

async fn write_text(Json(req): Json<WriteTextRequest>) -> AppResult {
    let path = req.path;
    let content = req.content;
    tokio::task::spawn_blocking(move || fleetfile_core::write_text_file(&path, &content))
        .await
        .map_err(|e| err(e))?
        .map_err(err)?;
    Ok(Json(serde_json::json!(null)))
}

async fn list_templates() -> Result<Json<Vec<fleetfile_core::FileTemplate>>, (StatusCode, Json<ErrorResponse>)> {
    Ok(Json(fleetfile_core::list_templates()))
}

async fn compress_files(Json(req): Json<CompressRequest>) -> AppResult {
    let sources = req.sources;
    let destination = req.destination;
    let format = req.format;
    let level = req.level.unwrap_or(6);
    tokio::task::spawn_blocking(move || {
        fleetfile_core::compress_files(&sources, &destination, &format, level)
    })
    .await
    .map_err(|e| err(e))?
    .map_err(err)?;
    Ok(Json(serde_json::json!(null)))
}

async fn extract_archive(Json(req): Json<ExtractRequest>) -> AppResult {
    let archive = req.archive;
    let destination = req.destination;
    let password = req.password;
    tokio::task::spawn_blocking(move || {
        fleetfile_core::extract_archive(&archive, &destination, password.as_deref())
    })
    .await
    .map_err(|e| err(e))?
    .map_err(err)?;
    Ok(Json(serde_json::json!(null)))
}

async fn archive_info(
    Query(q): Query<HashQuery>,
) -> Result<Json<Vec<fleetfile_core::ArchiveEntryInfo>>, (StatusCode, Json<ErrorResponse>)> {
    let path = q.path;
    tokio::task::spawn_blocking(move || fleetfile_core::list_archive(&path, None))
        .await
        .map_err(|e| err(e))?
        .map(Json)
        .map_err(err)
}

async fn hash_file(
    Query(q): Query<HashQuery>,
) -> Result<Json<fleetfile_core::HashInfo>, (StatusCode, Json<ErrorResponse>)> {
    let path = q.path;
    let algo = q.algo.unwrap_or_else(|| "sha256".into());
    tokio::task::spawn_blocking(move || fleetfile_core::hash_file(&path, &algo))
        .await
        .map_err(|e| err(e))?
        .map(Json)
        .map_err(err)
}

async fn office_text(
    Query(q): Query<PathQuery>,
) -> Result<Json<fleetfile_core::OfficeText>, (StatusCode, Json<ErrorResponse>)> {
    let path = q.path;
    tokio::task::spawn_blocking(move || fleetfile_core::office_text(&path))
        .await
        .map_err(|e| err(e))?
        .map(Json)
        .map_err(err)
}

async fn folder_compare(
    Json(req): Json<FolderCompareRequest>,
) -> Result<Json<Vec<fleetfile_core::CompareEntry>>, (StatusCode, Json<ErrorResponse>)> {
    let left = req.left;
    let right = req.right;
    tokio::task::spawn_blocking(move || fleetfile_core::folder_compare(&left, &right))
        .await
        .map_err(|e| err(e))?
        .map(Json)
        .map_err(err)
}

async fn duplicates(
    Json(req): Json<DuplicatesRequest>,
) -> Result<Json<Vec<fleetfile_core::DuplicateGroup>>, (StatusCode, Json<ErrorResponse>)> {
    let dir = req.dir;
    let min_size = req.min_size.unwrap_or(0);
    tokio::task::spawn_blocking(move || fleetfile_core::find_duplicates(&dir, min_size))
        .await
        .map_err(|e| err(e))?
        .map(Json)
        .map_err(err)
}

async fn sevenz_status() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "available": fleetfile_core::sevenz_available(),
        "binary": fleetfile_core::find_7z(),
        "rars": {
            "available": fleetfile_core::rars_available(),
            "binary": fleetfile_core::find_rars(),
        },
    }))
}

// ── Preferences (per-folder view settings + folder colors) ────────────────

#[derive(Deserialize)]
struct FolderViewRequest {
    path: String,
    view_mode: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
    group_by_date: Option<bool>,
}

#[derive(Deserialize)]
struct FolderColorRequest {
    path: String,
    color_id: String,
}

async fn get_preferences(State(state): State<AppState>) -> AppResult {
    let data = state.prefs.snapshot().await.map_err(err)?;
    Ok(Json(serde_json::to_value(data).unwrap_or_else(|_| json!({}))))
}

async fn put_folder_view(
    State(state): State<AppState>,
    Json(req): Json<FolderViewRequest>,
) -> AppResult {
    let merged = state
        .prefs
        .update_folder_view(
            &req.path,
            &settings::FolderViewSettings {
                view_mode: req.view_mode,
                sort_by: req.sort_by,
                sort_order: req.sort_order,
                group_by_date: req.group_by_date,
            },
        )
        .await
        .map_err(err)?;
    Ok(Json(serde_json::to_value(merged).unwrap_or_else(|_| json!({}))))
}

async fn delete_folder_view(
    State(state): State<AppState>,
    Query(q): Query<PathQuery>,
) -> AppResult {
    state.prefs.remove_folder_view(&q.path).await.map_err(err)?;
    Ok(Json(json!(null)))
}

async fn put_folder_color(
    State(state): State<AppState>,
    Json(req): Json<FolderColorRequest>,
) -> AppResult {
    state
        .prefs
        .set_folder_color(&req.path, &req.color_id)
        .await
        .map_err(err)?;
    Ok(Json(json!(null)))
}

async fn delete_folder_color(
    State(state): State<AppState>,
    Query(q): Query<PathQuery>,
) -> AppResult {
    state
        .prefs
        .remove_folder_color(&q.path)
        .await
        .map_err(err)?;
    Ok(Json(json!(null)))
}

async fn pty_ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_pty_socket(socket, state))
}

async fn handle_pty_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    let mut send_task = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            if sender.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    let hub = state.pty_hub.clone();
    let mut spawned: Vec<String> = Vec::new();
    while let Some(Ok(msg)) = receiver.next().await {
        match msg {
            Message::Text(text) => {
                if let Ok(cmd) = serde_json::from_str::<pty::PtyMsg>(&text) {
                    match cmd {
                        pty::PtyMsg::Spawn { id, cwd, cols, rows } => {
                            hub.spawn(&id, &cwd, cols, rows, out_tx.clone());
                            spawned.push(id);
                        }
                        pty::PtyMsg::Write { id, data } => hub.write(&id, &data),
                        pty::PtyMsg::Resize { id, cols, rows } => hub.resize(&id, cols, rows),
                        pty::PtyMsg::Kill { id } => {
                            hub.kill(&id);
                            spawned.retain(|x| x != &id);
                        }
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
    for id in spawned {
        hub.kill(&id);
    }
    send_task.abort();
}

async fn serve_asset(Query(q): Query<PathQuery>) -> impl IntoResponse {
    let path = PathBuf::from(&q.path);
    let content_type = content_type_for_path(&path);

    match tokio::fs::read(&path).await {
        Ok(data) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, content_type)],
            Body::from(data),
        )
            .into_response(),
        Err(e) => (
            StatusCode::NOT_FOUND,
            [(header::CONTENT_TYPE, "application/json")],
            Body::from(format!("{{\"error\":\"{}\"}}", e)),
        )
            .into_response(),
    }
}

fn content_type_for_path(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        Some("heic") => "image/heic",
        Some("mp4") => "video/mp4",
        Some("mkv") => "video/x-matroska",
        Some("avi") => "video/x-msvideo",
        Some("mov") => "video/quicktime",
        Some("webm") => "video/webm",
        Some("flv") => "video/x-flv",
        Some("wmv") => "video/x-ms-wmv",
        Some("mp3") => "audio/mpeg",
        Some("flac") => "audio/flac",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("m4a") => "audio/mp4",
        Some("aac") => "audio/aac",
        Some("pdf") => "application/pdf",
        Some("html") | Some("htm") => "text/html",
        Some("css") => "text/css",
        Some("js") | Some("mjs") => "application/javascript",
        Some("json") => "application/json",
        Some("xml") => "application/xml",
        Some("txt") | Some("md") | Some("log") => "text/plain",
        _ => "application/octet-stream",
    }
}

// ── WebSocket ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum WsClientMsg {
    Watch { path: String },
    Unwatch { path: String },
    Cancel { op: String },
    Ping,
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();

    let mut events_rx = state.events.subscribe();
    let send_task = tokio::spawn(async move {
        while let Ok(msg) = events_rx.recv().await {
            if sender.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    while let Some(Ok(msg)) = receiver.next().await {
        match msg {
            Message::Text(text) => {
                let parsed: Result<WsClientMsg, _> = serde_json::from_str(&text);
                match parsed {
                    Ok(WsClientMsg::Watch { path }) => state.watch.watch(&path).await,
                    Ok(WsClientMsg::Unwatch { path }) => state.watch.unwatch(&path).await,
                    Ok(WsClientMsg::Cancel { op }) => {
                        state.cancels.lock().unwrap().insert(op);
                    }
                    Ok(WsClientMsg::Ping) | Err(_) => {}
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    send_task.abort();
}

// ── Main ───────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let port: u16 = std::env::var("FLEETFILE_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3380);

    let static_dir = std::env::var("FLEETFILE_WEB_DIR")
        .unwrap_or_else(|_| "web/dist".to_string());

    let (events, _) = tokio::sync::broadcast::channel::<String>(512);
    let prefs = settings::SettingsStore::new(&settings::default_preferences_path())
        .await
        .expect("failed to open preferences database");
    let state = AppState {
        events: events.clone(),
        watch: Arc::new(WatchHub::new(events)),
        cancels: Arc::new(Mutex::new(HashSet::new())),
        op_counter: Arc::new(AtomicU64::new(0)),
        pty_hub: pty::PtyHub::default(),
        prefs: Arc::new(prefs),
    };

    let api = Router::new()
        .route("/read-dir", get(read_dir))
        .route("/drives", get(list_drives))
        .route("/user-dirs", get(user_dirs))
        .route("/properties", get(get_properties))
        .route("/search", get(search_files))
        .route("/thumbnail", get(thumbnail))
        .route("/templates", get(list_templates))
        .route("/archive-info", get(archive_info))
        .route("/7z-status", get(sevenz_status))
        .route("/preferences", get(get_preferences))
        .route("/preferences/folder-view", put(put_folder_view).delete(delete_folder_view))
        .route("/preferences/folder-color", put(put_folder_color).delete(delete_folder_color))
        .route("/hash", get(hash_file))
        .route("/office-text", get(office_text))
        .route("/compress", post(compress_files))
        .route("/extract", post(extract_archive))
        .route("/folder-compare", post(folder_compare))
        .route("/duplicates", post(duplicates))
        .route("/pty", get(pty_ws_handler))
        .route("/trash", get(list_trash))
        .route("/trash/restore", post(restore_trash))
        .route("/trash/restore-by-path", post(restore_trash_by_path))
        .route("/trash/delete", post(purge_trash))
        .route("/trash/empty", post(empty_trash))
        .route("/copy", post(copy_entry))
        .route("/move", post(move_entry))
        .route("/rename", post(rename_entry))
        .route("/bulk-rename", post(bulk_rename))
        .route("/write-text", post(write_text))
        .route("/delete", post(delete_entry))
        .route("/create-file", post(create_file))
        .route("/create-dir", post(create_dir))
        .route("/check-conflicts", post(check_conflicts))
        .route("/rename-destination", post(get_rename_destination))
        .route("/text-file", get(read_text_file))
        .route("/ws", get(ws_handler))
        .route("/asset", get(serve_asset))
        .with_state(state);

    let app = Router::new()
        .nest("/api", api)
        .fallback_service(
            ServeDir::new(&static_dir).not_found_service(ServeFile::new(format!(
                "{}/index.html",
                static_dir
            ))),
        );

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    println!("FleetFile server listening on http://{}", addr);
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind");
    axum::serve(listener, app).await.expect("server error");
}
