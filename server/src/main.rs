use std::io::Write;

use axum::{
    Router,
    body::{Body, to_bytes},
    extract,
    http::{HeaderMap, StatusCode, header},
    response::IntoResponse,
    routing::{get, post},
};
use rand::{distr::Alphanumeric, *};
use tokio::{
    fs::File,
    io::{self},
};
use tokio_util::io::ReaderStream;

const SHARE_DIR: &str = "shares";

fn get_share_path(id: &String) -> String {
    format!("{SHARE_DIR}/{id}")
}

async fn get_share_object(id: &String) -> io::Result<File> {
    File::open(get_share_path(id)).await
}

async fn create_share_object(id: &String) -> io::Result<File> {
    File::create_new(get_share_path(id)).await
}

async fn serve_share(extract::Path(id): extract::Path<String>) -> impl IntoResponse {
    match get_share_object(&id).await {
        Ok(file) => {
            let mut headers = HeaderMap::new();

            if let Ok(meta) = file.metadata().await {
                headers.insert(
                    header::CONTENT_LENGTH,
                    meta.len().to_string().parse().unwrap(),
                );
            }

            let stream = ReaderStream::new(file);
            let body = axum::body::Body::from_stream(stream);

            (StatusCode::OK, headers, body)
        }
        Err(_) => (
            StatusCode::NOT_FOUND,
            HeaderMap::new(),
            axum::body::Body::from("Share not found"),
        ),
    }
}

async fn generate_share(body: Body) -> impl IntoResponse {
    let new_id: String = rand::rng()
        .sample_iter(&Alphanumeric)
        .take(6)
        .map(char::from)
        .collect();

    println!("Generated new id: {new_id}");

    match create_share_object(&new_id).await {
        Ok(file) => {
            let bytes = to_bytes(body, usize::MAX).await.unwrap();
            file.into_std().await.write(&bytes).unwrap();
            let headers = HeaderMap::new();
            (StatusCode::OK, headers, Body::from(new_id))
        }
        Err(_) => (
            StatusCode::NOT_FOUND,
            HeaderMap::new(),
            axum::body::Body::from("Share not found"),
        ),
    }
}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/get/{id}", get(serve_share))
        .route("/share", post(generate_share));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3331")
        .await
        .unwrap();

    axum::serve(listener, app).await.unwrap();
}
