FROM ghcr.io/spiffe/spire-server:1.9.0 AS spire
FROM alpine:3.19
COPY --from=spire /opt/spire/bin/spire-server /opt/spire/bin/spire-server
COPY bootstrap.sh /opt/spire/bootstrap.sh
RUN chmod +x /opt/spire/bootstrap.sh
ENTRYPOINT ["/bin/sh", "/opt/spire/bootstrap.sh"]
