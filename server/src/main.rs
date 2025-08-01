use std::{fmt::Display, pin::pin};

use axum::{
    Router,
    body::Body,
    extract,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::IntoResponse,
    routing::{get, post},
};
use futures_util::TryStreamExt;
use rand::{distr::Alphanumeric, *};
use tokio::{
    fs::File,
    io::{self, BufWriter},
};
use tokio_util::io::{ReaderStream, StreamReader};

const ID_LENGTH: usize = 6;
const SHARE_DIR: &str = "shares";

enum ShareCreationError {
    InvalidId,
}

struct ShareId(String);

impl ShareId {
    fn new_random() -> Self {
        let new_id: String = rand::rng()
            .sample_iter(&Alphanumeric)
            .take(6)
            .map(char::from)
            .collect();
        ShareId(new_id)
    }

    fn decode(id: String) -> Result<ShareId, ShareCreationError> {
        if id.len() != ID_LENGTH {
            return Err(ShareCreationError::InvalidId);
        }
        if !id.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err(ShareCreationError::InvalidId);
        }
        Ok(ShareId(id.to_string()))
    }
}

impl Display for ShareId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

fn get_share_path(id: &ShareId) -> String {
    format!("{SHARE_DIR}/{}", id.0)
}

async fn get_share_object(id: &ShareId) -> io::Result<File> {
    File::open(get_share_path(id)).await
}

async fn create_share_object(id: &ShareId) -> io::Result<File> {
    File::create_new(get_share_path(id)).await
}

async fn serve_share(extract::Path(id): extract::Path<String>) -> impl IntoResponse {
    println!("Received request for share id: {id}");
    let Ok(share_id) = ShareId::decode(id) else {
        println!("Invalid id");
        return (StatusCode::UNAUTHORIZED, HeaderMap::new(), Body::empty());
    };

    match get_share_object(&share_id).await {
        Ok(file) => {
            println!("Serving share: {share_id}");
            let mut headers = HeaderMap::new();
            headers.append("Access-Control-Allow-Origin", HeaderValue::from_static("*"));

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
        Err(_) => {
            println!("Share not found: {share_id}");
            (
                StatusCode::NOT_FOUND,
                HeaderMap::new(),
                axum::body::Body::from("Share not found"),
            )
        }
    }
}

async fn serve_website(extract::Path(id): extract::Path<String>) -> impl IntoResponse {
    println!("Web request: {id}");
    let path = if id != "crypto.js" {
        "index.html".to_string()
    } else {
        id
    };
    match File::open(format!("static/{path}")).await {
        Ok(file) => {
            let stream = ReaderStream::new(file);
            let body = axum::body::Body::from_stream(stream);
            let mut headers = HeaderMap::new();
            headers.append("Access-Control-Allow-Origin", HeaderValue::from_static("*"));
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
    let share_id = ShareId::new_random();
    println!("Generated new id: {share_id}");
    match create_share_object(&share_id).await {
        Ok(file) => {
            let mut file = BufWriter::new(file);
            let mut stream = StreamReader::new(body.into_data_stream().map_err(io::Error::other));
            let mut body_reader = pin!(stream);
            io::copy(&mut body_reader, &mut file).await.unwrap();

            (StatusCode::OK, HeaderMap::new(), Body::from(share_id.0))
        }
        Err(_) => (
            StatusCode::NOT_FOUND,
            HeaderMap::new(),
            axum::body::Body::from("Share not found"),
        ),
    }
}

async fn serve_index() -> impl IntoResponse {
    serve_website(extract::Path("".to_string())).await
}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/get/{id}", get(serve_share))
        .route("/share", post(generate_share))
        .route("/{*file}", get(serve_website))
        .route("/", get(serve_index));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3331").await.unwrap();

    println!("Running on http://localhost:3331");

    axum::serve(listener, app).await.unwrap();
}
