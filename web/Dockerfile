FROM trzeci/emscripten:1.39.11-fastcomp@sha256:7e32f961a0b5280151f7f5e4d8de3e655ac054b5564ee707a81ea1512e8b9911

# Debian Buster is EOL; the historical toolchain image still points at the
# normal mirrors. Keep the original userspace, but use Debian's archive so the
# 2020 build environment remains installable in current CI.
RUN sed -i \
      -e 's|deb.debian.org/debian|archive.debian.org/debian|g' \
      -e 's|security.debian.org/debian-security|archive.debian.org/debian-security|g' \
      /etc/apt/sources.list && \
    apt-get -o Acquire::Check-Valid-Until=false update && \
    apt-get install -qqy --no-install-recommends automake libtool bison pkg-config && \
    rm -rf /var/lib/apt/lists/*
