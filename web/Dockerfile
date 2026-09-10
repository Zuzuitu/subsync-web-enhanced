FROM trzeci/emscripten

# The legacy image is based on Debian 10 (buster), whose normal mirrors were
# retired after EOL. Keep the historical Emscripten environment intact while
# pointing APT at Debian's official archive so the baseline remains reproducible.
RUN printf '%s\n' \
      'deb http://archive.debian.org/debian buster main' \
      'deb http://archive.debian.org/debian buster-updates main' \
      'deb http://archive.debian.org/debian-security buster/updates main' \
      > /etc/apt/sources.list && \
    apt-get -o Acquire::Check-Valid-Until=false update && \
    apt-get install -qqy automake libtool bison pkg-config
