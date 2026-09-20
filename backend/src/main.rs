use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::{HeaderMap, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{
    Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};
use std::{
    io::Write,
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use subtle::ConstantTimeEq;
use tokio::io::AsyncWriteExt;
use tower::ServiceExt;
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use uuid::Uuid;

#[derive(Clone)]
struct App {
    db: SqlitePool,
    dir: PathBuf,
    password: [u8; 32],
    secure: bool,
    login_attempts: Arc<tokio::sync::Mutex<Vec<i64>>>,
}
#[derive(Debug)]
struct Error(StatusCode, String);
type Result<T> = std::result::Result<T, Error>;
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        (self.0, Json(serde_json::json!({"error":self.1}))).into_response()
    }
}
impl From<sqlx::Error> for Error {
    fn from(e: sqlx::Error) -> Self {
        tracing::error!("database: {e}");
        Self(StatusCode::INTERNAL_SERVER_ERROR, "数据库操作失败".into())
    }
}
impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        tracing::error!("storage: {e}");
        Self(StatusCode::INTERNAL_SERVER_ERROR, "文件存储操作失败".into())
    }
}
fn bad(s: &str) -> Error {
    Error(StatusCode::BAD_REQUEST, s.into())
}
fn missing() -> Error {
    Error(StatusCode::NOT_FOUND, "文件或知识库不存在".into())
}
fn conflict() -> Error {
    Error(
        StatusCode::CONFLICT,
        "文件已在其他设备更新，请保留本地草稿并重新载入远端版本".into(),
    )
}
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}
fn hash(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}
fn valid_path(s: &str) -> Result<&str> {
    if s.is_empty()
        || s.len() > 1024
        || s.starts_with('/')
        || s.contains('\\')
        || s.chars().any(|c| c.is_control())
        || s.split('/')
            .any(|c| c.is_empty() || c == "." || c == ".." || c.len() > 255)
    {
        Err(bad("路径必须是有效的相对路径"))
    } else {
        Ok(s)
    }
}
fn format_of(s: &str) -> Result<&str> {
    match s.rsplit('.').next().unwrap_or("") {
        "md" => Ok("md"),
        "pdf" => Ok("pdf"),
        "docx" => Ok("docx"),
        "html" | "htm" => Ok("html"),
        _ => Err(bad("支持 .md、.pdf、.docx、.html 文件（扩展名使用小写）")),
    }
}
fn check_revision(headers: &HeaderMap, version: Option<i64>) -> Result<()> {
    let v = headers
        .get(header::IF_MATCH)
        .and_then(|s| s.to_str().ok())
        .unwrap_or("");
    if match version {
        Some(n) => v == format!("\"{n}\""),
        None => v == "*",
    } {
        Ok(())
    } else {
        Err(conflict())
    }
}

async fn init(dir: PathBuf, password: &str, secure: bool) -> Result<App> {
    tokio::fs::create_dir_all(dir.join("blobs")).await?;
    let options = SqliteConnectOptions::new()
        .filename(dir.join("folio.sqlite"))
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(std::time::Duration::from_secs(10));
    let db = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(options)
        .await?;
    sqlx::raw_sql("CREATE TABLE IF NOT EXISTS kbs(id TEXT PRIMARY KEY,name TEXT NOT NULL,created INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY,kb TEXT NOT NULL REFERENCES kbs(id) ON DELETE CASCADE,path TEXT NOT NULL,kind TEXT NOT NULL,format TEXT NOT NULL DEFAULT '',size INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,updated INTEGER NOT NULL,blob TEXT,UNIQUE(kb,path)); CREATE INDEX IF NOT EXISTS entries_kb ON entries(kb,path); CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY,entry TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,page INTEGER NOT NULL,x REAL NOT NULL,y REAL NOT NULL,text TEXT NOT NULL,created INTEGER NOT NULL,version INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,expires INTEGER NOT NULL);").execute(&db).await?;
    Ok(App {
        db,
        dir,
        password: Sha256::digest(password.as_bytes()).into(),
        secure,
        login_attempts: Arc::new(tokio::sync::Mutex::new(vec![])),
    })
}
async fn protect(State(app): State<App>, req: Request, next: Next) -> Response {
    let token = req
        .headers()
        .get(header::COOKIE)
        .and_then(|h| h.to_str().ok())
        .and_then(|c| {
            c.split(';')
                .find_map(|p| p.trim().strip_prefix("folio_session="))
        })
        .unwrap_or("");
    let ok = sqlx::query("SELECT 1 FROM sessions WHERE token=? AND expires>?")
        .bind(hash(token))
        .bind(now())
        .fetch_optional(&app.db)
        .await
        .ok()
        .flatten()
        .is_some();
    if !ok {
        return Error(StatusCode::UNAUTHORIZED, "请先解锁知识库".into()).into_response();
    }
    if !matches!(
        *req.method(),
        axum::http::Method::GET | axum::http::Method::HEAD
    ) && req
        .headers()
        .get("x-folio-request")
        .and_then(|v| v.to_str().ok())
        != Some("1")
    {
        return Error(StatusCode::FORBIDDEN, "缺少请求校验标记".into()).into_response();
    }
    next.run(req).await
}
async fn security(req: Request, next: Next) -> Response {
    let mut res = next.run(req).await;
    for (k, v) in [
        ("x-content-type-options", "nosniff"),
        ("referrer-policy", "no-referrer"),
        ("x-frame-options", "DENY"),
        ("cross-origin-resource-policy", "same-origin"),
        ("cache-control", "no-store"),
    ] {
        res.headers_mut()
            .insert(axum::http::HeaderName::from_static(k), v.parse().unwrap());
    }
    res
}
#[derive(Deserialize)]
struct Login {
    password: String,
}
async fn login(
    State(app): State<App>,
    headers: HeaderMap,
    Json(input): Json<Login>,
) -> Result<Response> {
    if headers.get("x-folio-request").and_then(|v| v.to_str().ok()) != Some("1") {
        return Err(Error(StatusCode::FORBIDDEN, "请求无效".into()));
    }
    let mut attempts = app.login_attempts.lock().await;
    attempts.retain(|t| *t > now() - 60);
    if attempts.len() >= 20 {
        return Err(Error(
            StatusCode::TOO_MANY_REQUESTS,
            "尝试过多，请一分钟后再试".into(),
        ));
    }
    attempts.push(now());
    let candidate: [u8; 32] = Sha256::digest(input.password.as_bytes()).into();
    if !bool::from(candidate.ct_eq(&app.password)) {
        return Err(Error(StatusCode::UNAUTHORIZED, "访问密码不正确".into()));
    }
    attempts.pop(); // Successful logins do not consume the failed-attempt budget.
    drop(attempts);
    let token = format!("{}{}", Uuid::new_v4(), Uuid::new_v4());
    sqlx::query("DELETE FROM sessions WHERE expires<?")
        .bind(now())
        .execute(&app.db)
        .await?;
    sqlx::query("INSERT INTO sessions VALUES(?,?)")
        .bind(hash(&token))
        .bind(now() + 2592000)
        .execute(&app.db)
        .await?;
    let cookie = format!(
        "folio_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000{}",
        if app.secure { "; Secure" } else { "" }
    );
    Ok((
        [(header::SET_COOKIE, cookie)],
        Json(serde_json::json!({"ok":true})),
    )
        .into_response())
}
async fn logout(State(app): State<App>, headers: HeaderMap) -> Result<Response> {
    if let Some(t) = headers
        .get(header::COOKIE)
        .and_then(|h| h.to_str().ok())
        .and_then(|c| {
            c.split(';')
                .find_map(|p| p.trim().strip_prefix("folio_session="))
        })
    {
        sqlx::query("DELETE FROM sessions WHERE token=?")
            .bind(hash(t))
            .execute(&app.db)
            .await?;
    }
    Ok((
        [(
            header::SET_COOKIE,
            "folio_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
        )],
        StatusCode::NO_CONTENT,
    )
        .into_response())
}
#[derive(Serialize)]
struct Kb {
    id: String,
    name: String,
    created: i64,
}
async fn kbs(State(app): State<App>) -> Result<Json<Vec<Kb>>> {
    Ok(Json(
        sqlx::query("SELECT * FROM kbs ORDER BY created,id")
            .fetch_all(&app.db)
            .await?
            .iter()
            .map(|r| Kb {
                id: r.get("id"),
                name: r.get("name"),
                created: r.get("created"),
            })
            .collect(),
    ))
}
#[derive(Deserialize)]
struct Name {
    name: String,
}
async fn create_kb(State(app): State<App>, Json(input): Json<Name>) -> Result<Json<Kb>> {
    let name = input.name.trim();
    if name.is_empty() || name.len() > 200 {
        return Err(bad("请输入 1–200 字节的知识库名称"));
    }
    let kb = Kb {
        id: Uuid::new_v4().to_string(),
        name: name.into(),
        created: now(),
    };
    sqlx::query("INSERT INTO kbs VALUES(?,?,?)")
        .bind(&kb.id)
        .bind(&kb.name)
        .bind(kb.created)
        .execute(&app.db)
        .await?;
    Ok(Json(kb))
}
async fn rename_kb(
    State(app): State<App>,
    Path(id): Path<String>,
    Json(input): Json<Name>,
) -> Result<StatusCode> {
    if input.name.trim().is_empty() || input.name.len() > 200 {
        return Err(bad("名称无效"));
    }
    if sqlx::query("UPDATE kbs SET name=? WHERE id=?")
        .bind(input.name.trim())
        .bind(id)
        .execute(&app.db)
        .await?
        .rows_affected()
        == 0
    {
        return Err(missing());
    }
    Ok(StatusCode::NO_CONTENT)
}
async fn delete_kb(State(app): State<App>, Path(id): Path<String>) -> Result<StatusCode> {
    sqlx::query("DELETE FROM kbs WHERE id=?")
        .bind(id)
        .execute(&app.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Serialize, Clone)]
struct Entry {
    id: String,
    kb: String,
    path: String,
    kind: String,
    format: String,
    size: i64,
    version: i64,
    updated: i64,
}
fn entry(r: &sqlx::sqlite::SqliteRow) -> Entry {
    Entry {
        id: r.get("id"),
        kb: r.get("kb"),
        path: r.get("path"),
        kind: r.get("kind"),
        format: r.get("format"),
        size: r.get("size"),
        version: r.get("version"),
        updated: r.get("updated"),
    }
}
async fn entries(State(app): State<App>, Path(kb): Path<String>) -> Result<Json<Vec<Entry>>> {
    Ok(Json(
        sqlx::query("SELECT * FROM entries WHERE kb=? ORDER BY kind DESC,path COLLATE NOCASE")
            .bind(kb)
            .fetch_all(&app.db)
            .await?
            .iter()
            .map(entry)
            .collect(),
    ))
}
async fn parent_exists(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    kb: &str,
    path: &str,
) -> Result<()> {
    if sqlx::query("SELECT id FROM kbs WHERE id=?")
        .bind(kb)
        .fetch_optional(&mut **tx)
        .await?
        .is_none()
    {
        return Err(missing());
    }
    if let Some((parent, _)) = path.rsplit_once('/')
        && sqlx::query("SELECT id FROM entries WHERE kb=? AND path=? AND kind='folder'")
            .bind(kb)
            .bind(parent)
            .fetch_optional(&mut **tx)
            .await?
            .is_none()
    {
        return Err(bad("父文件夹不存在"));
    }
    Ok(())
}
#[derive(Deserialize)]
struct AtPath {
    path: String,
}
async fn folder(
    State(app): State<App>,
    Path(kb): Path<String>,
    Json(input): Json<AtPath>,
) -> Result<Json<Entry>> {
    valid_path(&input.path)?;
    let mut tx = app.db.begin_with("BEGIN IMMEDIATE").await?;
    parent_exists(&mut tx, &kb, &input.path).await?;
    if sqlx::query("SELECT id FROM entries WHERE kb=? AND path=?")
        .bind(&kb)
        .bind(&input.path)
        .fetch_optional(&mut *tx)
        .await?
        .is_some()
    {
        return Err(conflict());
    }
    let e = Entry {
        id: Uuid::new_v4().to_string(),
        kb,
        path: input.path,
        kind: "folder".into(),
        format: "".into(),
        size: 0,
        version: 1,
        updated: now(),
    };
    sqlx::query("INSERT INTO entries(id,kb,path,kind,updated) VALUES(?,?,?,'folder',?)")
        .bind(&e.id)
        .bind(&e.kb)
        .bind(&e.path)
        .bind(e.updated)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(e))
}
const MAX_FILE: usize = 64 * 1024 * 1024;
async fn upload(
    State(app): State<App>,
    Path(kb): Path<String>,
    Query(input): Query<AtPath>,
    headers: HeaderMap,
    body: Body,
) -> Result<Json<Entry>> {
    valid_path(&input.path)?;
    let fmt = format_of(&input.path)?.to_owned();
    let blob = Uuid::new_v4().to_string();
    let tmp = app.dir.join("blobs").join(format!("{blob}.tmp"));
    let target = app.dir.join("blobs").join(&blob);
    let mut file = tokio::fs::File::create(&tmp).await?;
    let mut stream = body.into_data_stream();
    let mut size = 0usize;
    let mut prefix = Vec::new();
    let write_result: Result<()> = async {
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| bad("上传被中断"))?;
            size += chunk.len();
            if size > MAX_FILE {
                return Err(Error(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "单文件最大 64 MiB".into(),
                ));
            }
            if prefix.len() < 8 {
                prefix.extend_from_slice(&chunk[..chunk.len().min(8 - prefix.len())]);
            }
            file.write_all(&chunk).await?;
        }
        file.flush().await?;
        file.sync_all().await?;
        Ok(())
    }
    .await;
    drop(file);
    if let Err(e) = write_result {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(e);
    }
    let result:Result<Entry>=async{
        if (fmt=="pdf"&&!prefix.starts_with(b"%PDF-"))||(fmt=="docx"&&!prefix.starts_with(b"PK")){return Err(bad("文件内容与扩展名不匹配"));}
        if (fmt=="md"||fmt=="html") && (size>8*1024*1024 || tokio::fs::read_to_string(&tmp).await.is_err()){return Err(bad("文本须为 UTF-8 且小于 8 MiB"));}
        let mut tx=app.db.begin_with("BEGIN IMMEDIATE").await?;parent_exists(&mut tx,&kb,&input.path).await?;
        let existing=sqlx::query("SELECT * FROM entries WHERE kb=? AND path=?").bind(&kb).bind(&input.path).fetch_optional(&mut *tx).await?;
        if existing.as_ref().is_some_and(|r|r.get::<String,_>("kind")=="folder"){return Err(bad("该路径是文件夹"));}
        check_revision(&headers,existing.as_ref().map(|r|r.get("version")))?;
        if let Some(old)=&existing&& headers.get("x-folio-entry").and_then(|v|v.to_str().ok())!=Some(old.get::<String,_>("id").as_str()){return Err(conflict());}
        let e=Entry{id:existing.as_ref().map(|r|r.get("id")).unwrap_or_else(||Uuid::new_v4().to_string()),kb,path:input.path,kind:"file".into(),format:fmt,size:size as i64,version:existing.as_ref().map(|r|r.get::<i64,_>("version")+1).unwrap_or(1),updated:now()};
        tokio::fs::rename(&tmp,&target).await?;
        sqlx::query("INSERT INTO entries(id,kb,path,kind,format,size,version,updated,blob) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(kb,path) DO UPDATE SET size=excluded.size,version=excluded.version,updated=excluded.updated,blob=excluded.blob").bind(&e.id).bind(&e.kb).bind(&e.path).bind(&e.kind).bind(&e.format).bind(e.size).bind(e.version).bind(e.updated).bind(blob).execute(&mut *tx).await?;tx.commit().await?;Ok(e)
    }.await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(tmp).await;
        let _ = tokio::fs::remove_file(target).await;
    }
    result.map(Json)
}
#[derive(Deserialize)]
struct Revision {
    v: Option<i64>,
}
async fn content(
    State(app): State<App>,
    Path(id): Path<String>,
    Query(q): Query<Revision>,
    req: Request,
) -> Result<Response> {
    let r = sqlx::query("SELECT * FROM entries WHERE id=? AND kind='file'")
        .bind(id)
        .fetch_optional(&app.db)
        .await?
        .ok_or_else(missing)?;
    let version = r.get::<i64, _>("version");
    if q.v.is_some_and(|v| v != version) {
        return Err(conflict());
    }
    let etag = format!("\"{version}\"");
    if req
        .headers()
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        == Some(&etag)
    {
        return Ok(StatusCode::NOT_MODIFIED.into_response());
    }
    let mut res = ServeFile::new(app.dir.join("blobs").join(r.get::<String, _>("blob")))
        .oneshot(req)
        .await
        .unwrap()
        .into_response();
    res.headers_mut().insert(
        header::CONTENT_TYPE,
        "application/octet-stream".parse().unwrap(),
    );
    res.headers_mut()
        .insert(header::CONTENT_DISPOSITION, "attachment".parse().unwrap());
    res.headers_mut()
        .insert(header::ETAG, etag.parse().unwrap());
    Ok(res)
}
async fn move_entry(
    State(app): State<App>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<AtPath>,
) -> Result<StatusCode> {
    valid_path(&input.path)?;
    let mut tx = app.db.begin_with("BEGIN IMMEDIATE").await?;
    let r = sqlx::query("SELECT * FROM entries WHERE id=?")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(missing)?;
    let e = entry(&r);
    check_revision(&headers, Some(e.version))?;
    if input.path == e.path {
        return Ok(StatusCode::NO_CONTENT);
    }
    if input.path.starts_with(&format!("{}/", e.path)) {
        return Err(bad("不能移动到自身子目录"));
    }
    if e.kind == "file" && format_of(&input.path)? != e.format {
        return Err(bad("重命名不能改变文件类型"));
    }
    parent_exists(&mut tx, &e.kb, &input.path).await?;
    let rows = sqlx::query("SELECT * FROM entries WHERE kb=?")
        .bind(&e.kb)
        .fetch_all(&mut *tx)
        .await?;
    let prefix = format!("{}/", e.path);
    let changes: Vec<_> = rows
        .iter()
        .filter(|r| {
            r.get::<String, _>("path") == e.path || r.get::<String, _>("path").starts_with(&prefix)
        })
        .map(|r| {
            (
                r.get::<String, _>("id"),
                format!(
                    "{}{}",
                    input.path,
                    &r.get::<String, _>("path")[e.path.len()..]
                ),
            )
        })
        .collect();
    for (_, new) in &changes {
        valid_path(new)?;
        if rows.iter().any(|r| r.get::<String, _>("path") == *new) {
            return Err(bad("目标路径已存在"));
        }
    }
    for (id, new) in changes {
        sqlx::query("UPDATE comments SET version=version+1 WHERE entry=? AND version=(SELECT version FROM entries WHERE id=?)").bind(&id).bind(&id).execute(&mut *tx).await?;
        sqlx::query("UPDATE entries SET path=?,version=version+1,updated=? WHERE id=?")
            .bind(new)
            .bind(now())
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn remove_entry(
    State(app): State<App>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<StatusCode> {
    let mut tx = app.db.begin_with("BEGIN IMMEDIATE").await?;
    let r = sqlx::query("SELECT * FROM entries WHERE id=?")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(missing)?;
    let e = entry(&r);
    check_revision(&headers, Some(e.version))?;
    sqlx::query("DELETE FROM entries WHERE kb=? AND (path=? OR substr(path,1,length(?)+1)=?||'/')")
        .bind(e.kb)
        .bind(&e.path)
        .bind(&e.path)
        .bind(&e.path)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Serialize)]
struct Comment {
    id: String,
    page: i64,
    x: f64,
    y: f64,
    text: String,
    created: i64,
    version: i64,
}
async fn comments(State(app): State<App>, Path(id): Path<String>) -> Result<Json<Vec<Comment>>> {
    Ok(Json(
        sqlx::query("SELECT * FROM comments WHERE entry=? ORDER BY created,id")
            .bind(id)
            .fetch_all(&app.db)
            .await?
            .iter()
            .map(|r| Comment {
                id: r.get("id"),
                page: r.get("page"),
                x: r.get("x"),
                y: r.get("y"),
                text: r.get("text"),
                created: r.get("created"),
                version: r.get("version"),
            })
            .collect(),
    ))
}
#[derive(Deserialize)]
struct NewComment {
    page: i64,
    x: f64,
    y: f64,
    text: String,
    version: i64,
}
async fn add_comment(
    State(app): State<App>,
    Path(id): Path<String>,
    Json(c): Json<NewComment>,
) -> Result<Json<Comment>> {
    if c.page < 1
        || c.page > 100000
        || !c.x.is_finite()
        || !c.y.is_finite()
        || !(0.0..=1.0).contains(&c.x)
        || !(0.0..=1.0).contains(&c.y)
        || c.text.trim().is_empty()
        || c.text.len() > 10000
    {
        return Err(bad("批注内容或位置无效"));
    }
    let mut tx = app.db.begin_with("BEGIN IMMEDIATE").await?;
    let r = sqlx::query("SELECT * FROM entries WHERE id=? AND format='pdf'")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(missing)?;
    if r.get::<i64, _>("version") != c.version {
        return Err(conflict());
    }
    let out = Comment {
        id: Uuid::new_v4().to_string(),
        page: c.page,
        x: c.x,
        y: c.y,
        text: c.text.trim().into(),
        created: now(),
        version: c.version,
    };
    sqlx::query("INSERT INTO comments VALUES(?,?,?,?,?,?,?,?)")
        .bind(&out.id)
        .bind(id)
        .bind(out.page)
        .bind(out.x)
        .bind(out.y)
        .bind(&out.text)
        .bind(out.created)
        .bind(out.version)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(out))
}
async fn delete_comment(State(app): State<App>, Path(id): Path<String>) -> Result<StatusCode> {
    sqlx::query("DELETE FROM comments WHERE id=?")
        .bind(id)
        .execute(&app.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn export(State(app): State<App>, Path(kb): Path<String>) -> Result<Response> {
    let mut tx = app.db.begin().await?;
    if sqlx::query("SELECT id FROM kbs WHERE id=?")
        .bind(&kb)
        .fetch_optional(&mut *tx)
        .await?
        .is_none()
    {
        return Err(missing());
    }
    let entries = sqlx::query("SELECT * FROM entries WHERE kb=? ORDER BY path")
        .bind(&kb)
        .fetch_all(&mut *tx)
        .await?;
    let annotations:Vec<serde_json::Value>=sqlx::query("SELECT comments.*,entries.path FROM comments JOIN entries ON entries.id=comments.entry WHERE entries.kb=?").bind(&kb).fetch_all(&mut *tx).await?.iter().map(|r|serde_json::json!({"path":r.get::<String,_>("path"),"page":r.get::<i64,_>("page"),"x":r.get::<f64,_>("x"),"y":r.get::<f64,_>("y"),"text":r.get::<String,_>("text"),"version":r.get::<i64,_>("version")})).collect();
    tx.commit().await?;
    let tmp = app.dir.join(format!("export-{}.zip", Uuid::new_v4()));
    let zip_path = tmp.clone();
    let blobs = app.dir.join("blobs");
    tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        let f = std::fs::File::create(&zip_path)?;
        let mut zip = zip::ZipWriter::new(f);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for r in entries {
            let path = r.get::<String, _>("path");
            if r.get::<String, _>("kind") == "folder" {
                zip.add_directory(format!("files/{path}/"), options)?;
            } else {
                zip.start_file(format!("files/{path}"), options)?;
                std::io::copy(
                    &mut std::fs::File::open(blobs.join(r.get::<String, _>("blob")))?,
                    &mut zip,
                )?;
            }
        }
        zip.start_file("folio-comments.json", options)?;
        zip.write_all(serde_json::to_string_pretty(&annotations)?.as_bytes())?;
        zip.finish()?;
        Ok(())
    })
    .await
    .map_err(|_| bad("导出失败"))??;
    let req = Request::builder().body(Body::empty()).unwrap();
    let mut res = ServeFile::new(&tmp)
        .oneshot(req)
        .await
        .unwrap()
        .into_response();
    let _ = tokio::fs::remove_file(tmp).await;
    res.headers_mut()
        .insert(header::CONTENT_TYPE, "application/zip".parse().unwrap());
    res.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        "attachment; filename=folio-export.zip".parse().unwrap(),
    );
    Ok(res)
}
fn router(app: App, web: PathBuf) -> Router {
    let api = Router::new()
        .route(
            "/session",
            get(|| async { Json(serde_json::json!({"ok":true})) }),
        )
        .route("/logout", post(logout))
        .route("/kbs", get(kbs).post(create_kb))
        .route("/kbs/{id}", put(rename_kb).delete(delete_kb))
        .route("/kbs/{kb}/entries", get(entries))
        .route("/kbs/{kb}/folders", post(folder))
        .route("/kbs/{kb}/files", put(upload))
        .route("/kbs/{kb}/export", get(export))
        .route("/entries/{id}", put(move_entry).delete(remove_entry))
        .route("/entries/{id}/content", get(content))
        .route("/entries/{id}/comments", get(comments).post(add_comment))
        .route("/comments/{id}", delete(delete_comment))
        .route_layer(middleware::from_fn_with_state(app.clone(), protect))
        .fallback(|| async { Error(StatusCode::NOT_FOUND, "API 不存在".into()) });
    Router::new()
        .nest("/api", api)
        .route("/api/login", post(login))
        .route("/healthz", get(|| async { "ok" }))
        .fallback_service(
            ServeDir::new(&web).not_found_service(ServeFile::new(web.join("index.html"))),
        )
        .layer(DefaultBodyLimit::max(MAX_FILE))
        .layer(middleware::from_fn(security))
        .layer(TraceLayer::new_for_http())
        .with_state(app)
}
#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let bind = std::env::var("FOLIO_BIND").unwrap_or("127.0.0.1:8787".into());
    let password =
        std::env::var("FOLIO_PASSWORD").expect("Set FOLIO_PASSWORD (at least 12 characters)");
    assert!(
        password.len() >= 12,
        "FOLIO_PASSWORD must be at least 12 characters"
    );
    let dir = PathBuf::from(std::env::var("FOLIO_DATA").unwrap_or("./data".into()));
    let web = PathBuf::from(std::env::var("FOLIO_WEB").unwrap_or("../frontend/dist".into()));
    let secure = std::env::var("FOLIO_SECURE_COOKIE").unwrap_or_default() == "true";
    let app = init(dir, &password, secure)
        .await
        .expect("Initialize storage");
    let listener = tokio::net::TcpListener::bind(&bind)
        .await
        .expect("Bind server");
    println!("Folio listening on http://{bind}");
    axum::serve(listener, router(app, web))
        .with_graceful_shutdown(async {
            #[cfg(unix)]
            {
                let mut terminate =
                    tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                        .expect("SIGTERM handler");
                tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
            }
            #[cfg(not(unix))]
            {
                let _ = tokio::signal::ctrl_c().await;
            }
        })
        .await
        .unwrap();
}
#[cfg(test)]
mod tests;
