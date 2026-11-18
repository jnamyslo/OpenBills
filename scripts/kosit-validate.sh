#!/usr/bin/env bash
# Prüft Beispiel-E-Rechnungen (XRechnung UBL + ZUGFeRD/CII, inkl. Stornorechnung) mit dem
# KoSIT-Validator in Docker. Beispiele: src/utils/pdf/__tests__/kositSamples.test.ts
#
#   scripts/kosit-validate.sh            # lädt Validator + Konfiguration nach .kosit/ (einmalig)
#   KOSIT_DIR=/pfad scripts/kosit-validate.sh   # vorhandenen Download nutzen
#
# Exit-Code 0 nur, wenn alle Beispiele "ACCEPT" sind. Berichte: $KOSIT_DIR/reports/*.html
set -euo pipefail

VALIDATOR_VERSION=1.6.3
CONFIG_TAG=v2026-08-31
CONFIG_ZIP=xrechnung-3.0.2-validator-configuration-2026-08-31.zip

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=${KOSIT_DIR:-$ROOT/.kosit}
JAR=validator-$VALIDATOR_VERSION-standalone.jar
mkdir -p "$WORK"
rm -rf "$WORK/samples" "$WORK/reports"
mkdir -p "$WORK/samples" "$WORK/reports"

if [ ! -f "$WORK/$JAR" ]; then
  curl -fsSL -o "$WORK/$JAR" "https://github.com/itplr-kosit/validator/releases/download/v$VALIDATOR_VERSION/$JAR"
fi
if [ ! -f "$WORK/config/scenarios.xml" ]; then
  curl -fsSL -o "$WORK/$CONFIG_ZIP" "https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/$CONFIG_TAG/$CONFIG_ZIP"
  unzip -q -o "$WORK/$CONFIG_ZIP" -d "$WORK/config"
fi

echo "Erzeuge Beispiele …"
docker run --rm -e KOSIT_SAMPLES_OUT=/out -v "$ROOT":/src:ro -v "$WORK/samples":/out node:24-alpine sh -c \
  "mkdir /app && cd /src && tar cf - --exclude=node_modules --exclude=backend --exclude=.kosit . | tar xf - -C /app \
   && cd /app && npm ci --silent && npx vitest run src/utils/pdf/__tests__/kositSamples.test.ts" >/dev/null

echo "Validiere $(ls "$WORK/samples" | wc -l | tr -d ' ') Dateien (Validator $VALIDATOR_VERSION, Konfiguration $CONFIG_TAG) …"
docker run --rm -v "$WORK":/kosit eclipse-temurin:21-jre sh -c \
  "java -jar /kosit/$JAR -s /kosit/config/scenarios.xml -r /kosit/config -o /kosit/reports -h /kosit/samples/*.xml" \
  | sed -n '/^Results:/,$p' || true

# Ergebnis aus den Berichten, unabhängig vom Exit-Code des Validators
if grep -q '<rep:reject' "$WORK"/reports/*-report.xml; then
  echo "Abgelehnt:"; grep -l '<rep:reject' "$WORK"/reports/*-report.xml
  exit 1
fi
echo "Alle Beispiele akzeptiert."
