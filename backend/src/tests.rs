use super::*;
use http_body_util::BodyExt;
use serde_json::{Value, json};
struct TestApp {
    _dir: tempfile::TempDir,
    app: App,
    router: Router,
    cookie: String,
}
impl TestApp {
    async fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let app = init(dir.path().into(), "test-password-123", false)
            .await
            .unwrap();
        let router = router(app.clone(), dir.path().join("web"));
        let res = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/login")
                    .header("x-folio-request", "1")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"password":"test-password-123"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let cookie = res.headers()[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .into();
        Self {
            _dir: dir,
            app,
            router,
            cookie,
        }
    }
    async fn call(
        &self,
        method: &str,
        path: &str,
        body: &str,
        revision: Option<i64>,
        entry_id: Option<&str>,
    ) -> Response {
        let mut req = Request::builder()
            .method(method)
            .uri(path)
            .header("cookie", &self.cookie)
            .header("x-folio-request", "1")
            .header("content-type", "application/json")
            .header(
                "if-match",
                revision.map(|v| format!("\"{v}\"")).unwrap_or("*".into()),
            );
        if let Some(id) = entry_id {
            req = req.header("x-folio-entry", id);
        }
        self.router
            .clone()
            .oneshot(req.body(Body::from(body.to_owned())).unwrap())
            .await
            .unwrap()
    }
    async fn kb(&self) -> String {
        data(
            self.call("POST", "/api/kbs", r#"{"name":"Research"}"#, None, None)
                .await,
        )
        .await["id"]
            .as_str()
            .unwrap()
            .into()
    }
    async fn file(&self, kb: &str, path: &str, body: &str) -> Value {
        data(
            self.call(
                "PUT",
                &format!("/api/kbs/{kb}/files?path={path}"),
                body,
                None,
                None,
            )
            .await,
        )
        .await
    }
}
async fn data(r: Response) -> Value {
    assert_eq!(r.status(), StatusCode::OK);
    serde_json::from_slice(&r.into_body().collect().await.unwrap().to_bytes()).unwrap()
}
#[test]
fn paths_reject_traversal() {
    for path in [
        "../secret",
        "/etc/passwd",
        "a//b",
        "a/../b",
        "a\\b",
        "a/",
        ".",
        "a\nb",
    ] {
        assert!(valid_path(path).is_err(), "{path}");
    }
    assert!(valid_path("研究/笔记.md").is_ok());
}
#[tokio::test]
async fn auth_csrf_and_logout() {
    let t = TestApp::new().await;
    let r = t
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/kbs")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
    let r = t
        .router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/kbs")
                .header("cookie", &t.cookie)
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        t.call("POST", "/api/logout", "", None, None).await.status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        t.call("GET", "/api/kbs", "", None, None).await.status(),
        StatusCode::UNAUTHORIZED
    );
}
#[tokio::test]
async fn create_read_range_and_replace() {
    let t = TestApp::new().await;
    let kb = t.kb().await;
    let f = t.file(&kb, "notes.md", "# Hello world").await;
    let id = f["id"].as_str().unwrap();
    let res = t
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/entries/{id}/content?v=1"))
                .header("cookie", &t.cookie)
                .header("range", "bytes=0-6")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(
        res.into_body().collect().await.unwrap().to_bytes(),
        "# Hello"
    );
    let res = t
        .call(
            "PUT",
            &format!("/api/kbs/{kb}/files?path=notes.md"),
            "# Changed",
            Some(1),
            Some(id),
        )
        .await;
    assert_eq!(data(res).await["version"], 2);
    assert_eq!(
        t.call(
            "PUT",
            &format!("/api/kbs/{kb}/files?path=notes.md"),
            "stale",
            Some(1),
            Some(id)
        )
        .await
        .status(),
        StatusCode::CONFLICT
    );
    assert_eq!(
        t.call(
            "GET",
            &format!("/api/entries/{id}/content?v=1"),
            "",
            None,
            None
        )
        .await
        .status(),
        StatusCode::CONFLICT
    );
}
#[tokio::test]
async fn concurrent_writers_only_one_wins() {
    let t = TestApp::new().await;
    let kb = t.kb().await;
    let f = t.file(&kb, "a.md", "base").await;
    let id = f["id"].as_str().unwrap();
    let path = format!("/api/kbs/{kb}/files?path=a.md");
    let (a, b) = tokio::join!(
        t.call("PUT", &path, "one", Some(1), Some(id)),
        t.call("PUT", &path, "two", Some(1), Some(id))
    );
    let mut statuses = [a.status(), b.status()];
    statuses.sort();
    assert_eq!(statuses, [StatusCode::OK, StatusCode::CONFLICT]);
}
#[tokio::test]
async fn recreate_same_path_cannot_overwrite_with_old_identity() {
    let t = TestApp::new().await;
    let kb = t.kb().await;
    let f = t.file(&kb, "a.md", "original").await;
    let id = f["id"].as_str().unwrap();
    assert_eq!(
        t.call("DELETE", &format!("/api/entries/{id}"), "", Some(1), None)
            .await
            .status(),
        StatusCode::NO_CONTENT
    );
    t.file(&kb, "a.md", "replacement").await;
    assert_eq!(
        t.call(
            "PUT",
            &format!("/api/kbs/{kb}/files?path=a.md"),
            "stale draft",
            Some(1),
            Some(id)
        )
        .await
        .status(),
        StatusCode::CONFLICT
    );
}
#[tokio::test]
async fn folder_move_delete_are_recursive_and_literal() {
    let t = TestApp::new().await;
    let kb = t.kb().await;
    let folder = data(
        t.call(
            "POST",
            &format!("/api/kbs/{kb}/folders"),
            r#"{"path":"a_%"}"#,
            None,
            None,
        )
        .await,
    )
    .await;
    let other = data(
        t.call(
            "POST",
            &format!("/api/kbs/{kb}/folders"),
            r#"{"path":"abc"}"#,
            None,
            None,
        )
        .await,
    )
    .await;
    t.file(&kb, "a_%25/note.md", "one").await;
    t.file(&kb, "abc/note.md", "two").await;
    let id = folder["id"].as_str().unwrap();
    assert_eq!(
        t.call(
            "PUT",
            &format!("/api/entries/{id}"),
            r#"{"path":"moved"}"#,
            Some(1),
            None
        )
        .await
        .status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        t.call("DELETE", &format!("/api/entries/{id}"), "", Some(2), None)
            .await
            .status(),
        StatusCode::NO_CONTENT
    );
    let entries = data(
        t.call("GET", &format!("/api/kbs/{kb}/entries"), "", None, None)
            .await,
    )
    .await;
    assert_eq!(entries.as_array().unwrap().len(), 2);
    assert!(
        entries
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["id"] == other["id"])
    );
}
#[tokio::test]
async fn upload_validation_and_cleanup() {
    let t = TestApp::new().await;
    let kb = t.kb().await;
    for (path, body, status) in [
        ("../bad.md", "x", 400),
        ("bad.pdf", "not a PDF", 400),
        ("bad.exe", "x", 400),
        ("missing/file.md", "x", 400),
    ] {
        assert_eq!(
            t.call(
                "PUT",
                &format!("/api/kbs/{kb}/files?path={path}"),
                body,
                None,
                None
            )
            .await
            .status()
            .as_u16(),
            status
        );
    }
    assert_eq!(
        std::fs::read_dir(t.app.dir.join("blobs")).unwrap().count(),
        0
    );
}
#[tokio::test]
async fn pdf_comments_version_and_export() {
    let t = TestApp::new().await;
    let kb = t.kb().await;
    let f = t.file(&kb, "paper.pdf", "%PDF-1.4 test").await;
    let id = f["id"].as_str().unwrap();
    let route = format!("/api/entries/{id}/comments");
    let payload = json!({"page":1,"x":0.2,"y":0.3,"text":"A thought","version":1}).to_string();
    data(t.call("POST", &route, &payload, None, None).await).await;
    let bad = json!({"page":1,"x":1.2,"y":0.3,"text":"bad","version":1}).to_string();
    assert_eq!(
        t.call("POST", &route, &bad, None, None).await.status(),
        StatusCode::BAD_REQUEST
    );
    let response = t
        .call("GET", &format!("/api/kbs/{kb}/export"), "", None, None)
        .await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    assert!(zip.by_name("files/paper.pdf").is_ok());
    let mut comments = String::new();
    std::io::Read::read_to_string(
        &mut zip.by_name("folio-comments.json").unwrap(),
        &mut comments,
    )
    .unwrap();
    assert!(comments.contains("A thought"));
    data(
        t.call(
            "PUT",
            &format!("/api/kbs/{kb}/files?path=paper.pdf"),
            "%PDF-1.4 updated",
            Some(1),
            Some(id),
        )
        .await,
    )
    .await;
    assert_eq!(
        t.call("POST", &route, &payload, None, None).await.status(),
        StatusCode::CONFLICT
    );
}
#[tokio::test]
async fn html_always_downloaded_with_nosniff() {
    let t = TestApp::new().await;
    let kb = t.kb().await;
    let f = t.file(&kb, "page.html", "<script>alert(1)</script>").await;
    let r = t
        .call(
            "GET",
            &format!("/api/entries/{}/content", f["id"].as_str().unwrap()),
            "",
            None,
            None,
        )
        .await;
    assert_eq!(
        r.headers()[header::CONTENT_TYPE],
        "application/octet-stream"
    );
    assert_eq!(r.headers()[header::CONTENT_DISPOSITION], "attachment");
    assert_eq!(r.headers()["x-content-type-options"], "nosniff");
}
#[tokio::test]
async fn deletion_is_scoped_to_kb() {
    let t = TestApp::new().await;
    let a = t.kb().await;
    let b = t.kb().await;
    t.file(&a, "a.md", "a").await;
    t.file(&b, "b.md", "b").await;
    t.call("DELETE", &format!("/api/kbs/{a}"), "", None, None)
        .await;
    let entries = data(
        t.call("GET", &format!("/api/kbs/{b}/entries"), "", None, None)
            .await,
    )
    .await;
    assert_eq!(entries.as_array().unwrap().len(), 1);
}
