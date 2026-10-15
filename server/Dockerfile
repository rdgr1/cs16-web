# syntax=docker/dockerfile:1
# Estagio 1: baixa so o libsteam_api.so do app 90 (HLDS) com DepotDownloader, anonimo.
# Precisa do branch steam_legacy: o ReHLDS espera a lib antiga (SteamGameServer_Init).
# Roda na arquitetura nativa do build (SteamCMD da segfault sob emulacao x86 em Mac ARM).
FROM debian:bookworm AS steam
ARG DD_VERSION=3.4.0
ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates libssl3 \
    && apt-get clean
RUN ARCH=$([ "$(dpkg --print-architecture)" = "amd64" ] && echo x64 || dpkg --print-architecture) \
 && curl -fsSL https://github.com/SteamRE/DepotDownloader/releases/download/DepotDownloader_${DD_VERSION}/DepotDownloader-linux-${ARCH}.zip -o /tmp/dd.zip \
 && unzip -q /tmp/dd.zip -d /dd && chmod +x /dd/DepotDownloader \
 && printf 'regex:^libsteam_api\\.so$\nregex:^steamclient\\.so$\n' > /tmp/filelist.txt \
 && /dd/DepotDownloader -app 90 -beta steam_legacy -os linux -osarch 32 -filelist /tmp/filelist.txt -dir /out \
 && test -s /out/libsteam_api.so && test -s /out/steamclient.so

# Estagio 2: ReHLDS + ReGameDLL (releases oficiais)
FROM --platform=linux/amd64 debian:bookworm-slim
ARG REHLDS_VERSION=3.15.0.896
ARG REGAMEDLL_VERSION=5.30.0.814
RUN dpkg --add-architecture i386 && apt-get update && apt-get install -y --no-install-recommends \
      libc6:i386 libstdc++6:i386 ca-certificates curl unzip \
    && apt-get clean
WORKDIR /hlds
RUN curl -fsSL https://github.com/rehlds/ReHLDS/releases/download/${REHLDS_VERSION}/rehlds-bin-${REHLDS_VERSION}.zip -o /tmp/rehlds.zip \
 && curl -fsSL https://github.com/rehlds/ReGameDLL_CS/releases/download/${REGAMEDLL_VERSION}/regamedll-bin-${REGAMEDLL_VERSION}.zip -o /tmp/regamedll.zip \
 && unzip -q /tmp/rehlds.zip 'bin/linux32/*' -d /tmp/r && unzip -q /tmp/regamedll.zip 'bin/linux32/*' -d /tmp/g \
 && cp -r /tmp/r/bin/linux32/. /hlds/ && cp -r /tmp/g/bin/linux32/. /hlds/
COPY --from=steam /out/libsteam_api.so /out/steamclient.so /hlds/
RUN mkdir -p /root/.steam/sdk32 && cp /hlds/steamclient.so /root/.steam/sdk32/steamclient.so
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /hlds/hlds_linux
ENV LD_LIBRARY_PATH=/hlds
EXPOSE 27015/udp
ENTRYPOINT ["/entrypoint.sh"]
