FROM ghcr.io/spiffe/spire-agent:1.9.0 AS spire
FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=spire /opt/spire/bin/spire-agent /opt/spire/bin/spire-agent
COPY agent/entrypoint.sh /opt/spire/entrypoint.sh
COPY agent/agent.conf /opt/spire/conf/agent/agent.conf
RUN chmod +x /opt/spire/entrypoint.sh
ENTRYPOINT ["/bin/sh", "/opt/spire/entrypoint.sh"]
