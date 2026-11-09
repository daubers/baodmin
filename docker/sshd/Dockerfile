# A tiny SSH server for the docker-compose demo. It trusts certificates signed by the CA in OpenBao's ssh/
# engine: the entrypoint fetches the CA public key from OpenBao at start-up. Throwaway; not hardened for real use.
FROM alpine:3.22

RUN apk add --no-cache openssh-server curl \
 && ssh-keygen -A \
 && for u in deploy alice; do \
      adduser -D -s /bin/sh "$u" \
      # sshd refuses locked accounts even for key logins, so give each a random password (password logins are off).
      && echo "$u:$(head -c 24 /dev/urandom | base64)" | chpasswd; \
    done

COPY sshd_config /etc/ssh/sshd_config
COPY sample-data/deploy/ /home/deploy/
COPY sample-data/alice/ /home/alice/
RUN chown -R deploy:deploy /home/deploy && chown -R alice:alice /home/alice

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 22
ENTRYPOINT ["/entrypoint.sh"]
