# enum4linux-ng v1.3.4, source from the tool's own repository (docker/enum4linux-ng/src, unmodified release tarball).
# Dependencies come from Debian packages. Build: docker build -t naqb/enum4linux-ng:1.3.4 docker/enum4linux-ng
FROM debian:trixie-slim
# deb.debian.org's CDN returns 403 for some packages on some networks, so use another mirror.
RUN sed -i 's#^URIs: http://deb.debian.org/debian$#URIs: http://mirrors.kernel.org/debian#' /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get -o Acquire::Retries=8 -o Acquire::Queue-Mode=access install -y --fix-missing --no-install-recommends \
      python3 python3-impacket python3-ldap3 python3-yaml smbclient samba-common-bin ldap-utils nmap \
 && rm -rf /var/lib/apt/lists/*
COPY src /opt/e4l
ENTRYPOINT ["python3", "/opt/e4l/enum4linux-ng.py"]
