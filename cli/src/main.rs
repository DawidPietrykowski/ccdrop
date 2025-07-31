use std::{convert::Infallible, fs, path::PathBuf};

use aes_gcm::{
    Aes256Gcm, Key,
    aead::{Aead, AeadCore, KeyInit, OsRng, generic_array::GenericArray},
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE};

use clap::{Parser, Subcommand};

const NONCE_SIZE: usize = 12;

#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
#[command(
    version, about, long_about = None, after_help =
    "Example usage:
    cargo run -- -p file.txt send
    cargo run -- -i ABC -k LAeMwZtS6WvT6jsjigmPHa2g1rpJ7fGPuC9rU= get"
)]
struct Args {
    #[arg(short, long)]
    id: Option<String>,

    #[arg(short, long)]
    key: Option<String>,

    #[arg(short, long)]
    path: Option<PathBuf>,

    #[arg(short, long, default_value = "http://localhost:3000")]
    url: String,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    Get,
    Send,
}

fn encrypt(plaintext: &[u8], cipher: &Aes256Gcm) -> Result<Vec<u8>, aes_gcm::Error> {
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher.encrypt(&nonce, plaintext)?;

    let mut result = Vec::with_capacity(NONCE_SIZE + ciphertext.len());
    result.extend_from_slice(&nonce);
    result.extend_from_slice(&ciphertext);

    Ok(result)
}

fn decrypt(data: &[u8], cipher: &Aes256Gcm) -> Result<Vec<u8>, aes_gcm::Error> {
    let (nonce, ciphertext) = data.split_at(12);
    let nonce = GenericArray::from_slice(nonce);
    let decrypted_data = cipher.decrypt(nonce, ciphertext)?;
    Ok(decrypted_data)
}

fn generate_cipher(base64_key: String) -> Aes256Gcm {
    let decoded_key = URL_SAFE.decode(base64_key).unwrap();
    let key = GenericArray::from_slice(&decoded_key);
    Aes256Gcm::new(&key)
}

fn generate_random_cipher() -> Result<(Aes256Gcm, Key<Aes256Gcm>), Infallible> {
    let key = Aes256Gcm::generate_key(&mut OsRng);
    Ok((Aes256Gcm::new(&key), key))
}

fn encode_key(key: Key<Aes256Gcm>) -> String {
    let key: [u8; 32] = key.into();
    URL_SAFE.encode(key)
}

fn get_url(url: String, id: String) -> String {
    format!("{url}/get/{id}")
}

fn share_url(url: String) -> String {
    format!("{url}/share")
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();

    match args.command {
        Command::Get => {
            let cipher = generate_cipher(args.key.unwrap());
            let client = reqwest::Client::new();
            let res = client
                .get(get_url(args.url, args.id.unwrap()))
                .send()
                .await?;
            assert!(res.status().is_success());

            let body = res.bytes().await?;
            let decrypted = decrypt(&body, &cipher).unwrap();

            fs::write("output", decrypted).unwrap();
        }
        Command::Send => {
            let file = fs::read(args.path.unwrap()).unwrap();

            let (cipher, key) = generate_random_cipher().unwrap();
            let base64_key = encode_key(key);
            let encryted = encrypt(&file, &cipher).unwrap();

            let client = reqwest::Client::new();
            let res = client
                .post(share_url(args.url))
                .body(encryted)
                .send()
                .await?;
            println!("{:?}", res);
            assert!(res.status().is_success());

            let code = res.text().await?;

            println!("cargo run -- -i {code} -k {base64_key} get");
        }
    }

    Ok(())
}
