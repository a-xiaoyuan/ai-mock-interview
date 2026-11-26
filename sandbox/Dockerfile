# 算法题沙箱镜像：Java / Python / C++ / Go / JavaScript。
# 构建上下文只用 sandbox 目录，不要把仓库根目录送进构建，避免 .env 和密钥被打包。
#   npm run sandbox-image
# 运行限制不写在镜像里，由 lib/sandbox.js 在每次启动时加上：
# 只读根文件系统、无网络、非 root、去掉 capabilities、限制内存和进程数。
# 镜像本身没有密钥。更新系统包后请重新构建。

FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        g++ \
        golang-go \
        openjdk-17-jdk-headless \
        nodejs \
    && if [ ! -x /usr/bin/node ] && [ -x /usr/bin/nodejs ]; then ln -s /usr/bin/nodejs /usr/bin/node; fi \
    && command -v node >/dev/null \
    && command -v python3 >/dev/null \
    && command -v java >/dev/null \
    && command -v g++ >/dev/null \
    && command -v go >/dev/null \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 sandbox \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin sandbox

USER sandbox
WORKDIR /work
