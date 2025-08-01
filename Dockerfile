FROM rust:1.88 AS builder

WORKDIR /usr/src/ccdrop

COPY ./server ./server
COPY ./cli ./cli
COPY ./Cargo.toml ./Cargo.toml

RUN rustup target add x86_64-unknown-linux-musl

RUN cargo build --target x86_64-unknown-linux-musl --profile release --bin ccdrop-server

RUN file /usr/src/ccdrop/target/x86_64-unknown-linux-musl/release/ccdrop-server

FROM alpine:latest

COPY --from=builder /usr/src/ccdrop/target/x86_64-unknown-linux-musl/release/ccdrop-server /bin/ccdrop-server

WORKDIR /data
RUN mkdir -p /data/shares

COPY ./static /data/static

ENTRYPOINT ["/bin/ccdrop-server"]
