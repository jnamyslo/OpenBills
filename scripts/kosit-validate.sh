#!/usr/bin/env bash
# Prüft Beispiel-E-Rechnungen (XRechnung UBL + ZUGFeRD/CII, inkl. Stornorechnung) mit dem
# KoSIT-Validator in Docker. Beispiele: src/utils/pdf/__tests__/kositSamples.test.ts
#
#   scripts/kosit-validate.sh            # lädt Validator + Konfiguration nach .kosit/ (einmalig)
#   KOSIT_DIR=/pfad scripts/kosit-validate.sh   # vorhandenen Download nutzen
#   scripts/kosit-validate.sh --check-only      # nur vorhandene Berichte in $KOSIT_DIR auswerten
#
# Exit-Code 0 nur, wenn alle Beispiele "ACCEPT" sind. Berichte: $KOSIT_DIR/reports/*.html
set -euo pipefail

VALIDATOR_VERSION=1.6.3
CONFIG_TAG=v2026-08-31
CONFIG_ZIP=xrechnung-3.0.2-validator-configuration-2026-08-31.zip

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=${KOSIT_DIR:-$ROOT/.kosit}
JAR=validator-$VALIDATOR_VERSION-standalone.jar

# Erfolg nur, wenn es zu jedem Beispiel einen Bericht gibt und jeder Bericht "accept" enthält.
check_reports() {
  local samples reports file failed=0
  samples=$(find "$WORK/samples" -maxdepth 1 -name '*.xml' 2>/dev/null | wc -l | tr -d ' ')
  reports=$(find "$WORK/reports" -maxdepth 1 -name '*-report.xml' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$samples" -eq 0 ] || [ "$reports" -ne "$samples" ]; then
    echo "Fehler: $reports Berichte für $samples Beispiele – Validator abgestürzt?" >&2
    return 1
  fi
  for file in "$WORK"/reports/*-report.xml; do
    if ! grep -q '<rep:accept' "$file"; then
      [ "$failed" -eq 0 ] && echo "Abgelehnt:"
      echo "$file"; failed=1
    fi
  done
  [ "$failed" -eq 0 ] || return 1
  echo "Alle Beispiele akzeptiert."
}

if [ "${1:-}" = "--check-only" ]; then
  check_reports
  exit $?
fi

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
check_reports
