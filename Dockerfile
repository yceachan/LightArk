# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS web
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM rust:1.98.1-bookworm AS api
WORKDIR /build
COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/src ./src
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/* && useradd --uid 10001 --create-home folio && mkdir /data && chown folio:folio /data
COPY --from=api /build/target/release/folio-kb /usr/local/bin/folio-kb
COPY --from=web /build/dist /app/web
USER 10001:10001
ENV FOLIO_BIND=0.0.0.0:8787 FOLIO_DATA=/data FOLIO_WEB=/app/web RUST_LOG=info
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD curl -fsS http://127.0.0.1:8787/healthz || exit 1
CMD ["folio-kb"]
