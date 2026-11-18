#!/usr/bin/env bash
# Prüft Beispiel-PDFs (Rechnung, Storno, Angebot, Mahnung) als PDF/A-3b mit veraPDF und die
# ZUGFeRD-Rechnungen (*-zugferd.pdf) zusätzlich mit dem Mustang-Validator, jeweils in Docker.
# Beispiele: src/utils/pdf/__tests__/pdfaSamples.test.ts
#
#   scripts/pdfa-validate.sh                  # lädt Mustang nach .pdfa/ (einmalig)
#   PDFA_DIR=/pfad scripts/pdfa-validate.sh   # vorhandenen Download nutzen
#   scripts/pdfa-validate.sh --skip-mustang   # nur veraPDF
#
# Exit-Code 0 nur, wenn alle Beispiele bestehen. Berichte: $PDFA_DIR/reports/
set -euo pipefail

VERAPDF_IMAGE=verapdf/cli:v1.30.4
MUSTANG_VERSION=2.26.0

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=${PDFA_DIR:-$ROOT/.pdfa}
JAR=Mustang-CLI-$MUSTANG_VERSION.jar
SKIP_MUSTANG=${1:-}

rm -rf "$WORK/samples" "$WORK/reports"
mkdir -p "$WORK/samples" "$WORK/reports"

echo "Erzeuge Beispiele …"
docker run --rm -e PDFA_SAMPLES_OUT=/out -v "$ROOT":/src:ro -v "$WORK/samples":/out node:24-alpine sh -c \
  "mkdir /app && cd /src && tar cf - --exclude=node_modules --exclude=backend --exclude=.kosit --exclude=.pdfa . | tar xf - -C /app \
   && cd /app && npm ci --silent && npx vitest run src/utils/pdf/__tests__/pdfaSamples.test.ts" >/dev/null

count=$(find "$WORK/samples" -maxdepth 1 -name '*.pdf' | wc -l | tr -d ' ')
[ "$count" -gt 0 ] || { echo "Fehler: keine Beispiele erzeugt" >&2; exit 1; }

failed=0
echo "veraPDF ($VERAPDF_IMAGE), PDF/A-3b, $count Dateien …"
docker run --rm -v "$WORK/samples":/data "$VERAPDF_IMAGE" --flavour 3b --format text --recurse /data \
  | tee "$WORK/reports/verapdf.txt"
passed=$(grep -c '^PASS ' "$WORK/reports/verapdf.txt" || true)
[ "$passed" -eq "$count" ] || { echo "veraPDF: $passed von $count bestanden" >&2; failed=1; }

if [ "$SKIP_MUSTANG" != "--skip-mustang" ]; then
  if [ ! -f "$WORK/$JAR" ]; then
    curl -fsSL -o "$WORK/$JAR" "https://github.com/ZUGFeRD/mustangproject/releases/download/core-$MUSTANG_VERSION/$JAR"
  fi
  for file in "$WORK"/samples/*-zugferd.pdf; do
    name=$(basename "$file" .pdf)
    docker run --rm -v "$WORK":/w eclipse-temurin:21-jre \
      java -jar "/w/$JAR" --action validate --no-notices --source "/w/samples/$name.pdf" \
      > "$WORK/reports/$name-mustang.xml" 2>/dev/null || true
    if grep -q 'status="valid"' "$WORK/reports/$name-mustang.xml"; then
      echo "PASS $name (Mustang $MUSTANG_VERSION)"
    else
      echo "FAIL $name (Mustang $MUSTANG_VERSION) – siehe reports/$name-mustang.xml"; failed=1
    fi
  done
fi

[ "$failed" -eq 0 ] && echo "Alle Beispiele bestanden." || exit 1
