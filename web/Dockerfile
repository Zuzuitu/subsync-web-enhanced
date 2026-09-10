# Pin the historical Emscripten generation used when the web build was introduced.
# The untagged image later moved its "latest" tag to the upstream LLVM backend,
# which is not a faithful reproduction of the March 2020 build environment.
FROM trzeci/emscripten:1.39.11-fastcomp

# Debian 10 (buster) is EOL and its normal mirrors were retired. Keep the
# historical compiler image but use Debian's official archive repositories.
RUN printf '%s\n' \
      'deb http://archive.debian.org/debian buster main' \
      'deb http://archive.debian.org/debian buster-updates main' \
      'deb http://archive.debian.org/debian-security buster/updates main' \
      > /etc/apt/sources.list && \
    apt-get -o Acquire::Check-Valid-Until=false update && \
    apt-get install -qqy automake libtool bison pkg-config
