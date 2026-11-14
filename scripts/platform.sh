#!/bin/bash
# Gemeinsame Logik für Plattform-Mailversand (von deploy-instance.sh und manage-instances.sh geladen).
# Tarife free/starter/professional versenden über den Plattform-Relay; Zugangsdaten liegen nur in
# .env.platform (nicht im Repo) und werden per docker-compose.platform.yml nur diesen Instanzen gegeben.
# Erwartet print_info/print_error/print_success aus dem aufrufenden Skript und das Repo-Root als cwd.
# Spec: docs/superpowers/specs/2026-11-14-platform-mail-design.md

PLATFORM_PLANS="free starter professional"
PLATFORM_ENV_FILE=".env.platform"
PLATFORM_COMPOSE_FILE="docker-compose.platform.yml"
PLATFORM_INSTANCE_NAME_REGEX='^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'

# is_platform_plan <plan> → 0, wenn der Tarif über den Plattform-Relay versendet
is_platform_plan() {
    local plan="$1" p
    [ -z "$plan" ] && return 1
    for p in $PLATFORM_PLANS; do
        [ "$p" = "$plan" ] && return 0
    done
    return 1
}

# instance_plan <name> → Tarif aus .env.backend.<name> (leer = self-hosted)
instance_plan() {
    local file=".env.backend.$1"
    [ -f "$file" ] || return 0
    grep -E '^OPENBILLS_PLAN=' "$file" | tail -1 | cut -d'=' -f2- | tr -d '"'"'"'\r '
}

# is_demo_instance <name> → 0, wenn .env.backend.<name> OPENBILLS_DEMO=true setzt (öffentliche Demo, kein Onboarding/Support-Zugang)
is_demo_instance() {
    local file=".env.backend.$1"
    [ -f "$file" ] || return 1
    [ "$(grep -E '^OPENBILLS_DEMO=' "$file" | tail -1 | cut -d'=' -f2- | tr -d '"'"'"'\r ')" = "true" ]
}

# is_valid_platform_instance_name <name> → 0, wenn der Name als Absender <name>@openbills.de taugt
is_valid_platform_instance_name() {
    [[ "$1" =~ $PLATFORM_INSTANCE_NAME_REGEX ]]
}

# compose_cmd <name> → setzt das Array COMPOSE für docker compose.
# Plattform-Tarife bekommen den Override (nur wenn .env.platform existiert, damit stop/logs/remove
# auch ohne Datei funktionieren; start/restart prüfen vorher mit check_platform_ready).
compose_cmd() {
    local name="$1"
    COMPOSE=(docker compose --env-file ".env.${name}" -f docker-compose.yml)
    if is_platform_plan "$(instance_plan "$name")" && [ -f "$PLATFORM_ENV_FILE" ]; then
        COMPOSE+=(-f "$PLATFORM_COMPOSE_FILE")
    fi
}

# check_platform_ready <name> → 1 mit Meldung, wenn eine Plattform-Instanz nicht starten darf
check_platform_ready() {
    local name="$1"
    is_platform_plan "$(instance_plan "$name")" || return 0
    if [ ! -f "$PLATFORM_ENV_FILE" ]; then
        print_error "Plattform-Mailzugang fehlt: $PLATFORM_ENV_FILE anlegen (./deploy-instance.sh fragt ihn ab)."
        return 1
    fi
    if ! is_valid_platform_instance_name "$name"; then
        print_error "Instanzname '$name' ist für Tarife mit Plattform-Mailversand ungültig (nur a-z, 0-9 und '-', nicht am Anfang/Ende)."
        return 1
    fi
    return 0
}

# ensure_platform_env → fragt den Brevo-Zugang einmalig interaktiv ab und legt .env.platform an
ensure_platform_env() {
    [ -f "$PLATFORM_ENV_FILE" ] && return 0
    echo
    print_info "=== Plattform-Mailzugang (einmalig pro Host) ==="
    print_info "Systemmails (support@openbills.de) und Starter-Kundenmails laufen über diesen Relay."
    local host port user pass
    read -r -p "SMTP-Host [smtp-relay.brevo.com]: " host
    host=${host:-smtp-relay.brevo.com}
    read -r -p "SMTP-Port [587]: " port
    port=${port:-587}
    while [ -z "$user" ]; do
        read -r -p "SMTP-Benutzer (Brevo-Login): " user
    done
    while [ -z "$pass" ]; do
        read -r -s -p "SMTP-Key (Eingabe verdeckt): " pass
        echo
    done
    (
        umask 077
        cat > "$PLATFORM_ENV_FILE" << EOF
PLATFORM_SMTP_HOST=${host}
PLATFORM_SMTP_PORT=${port}
PLATFORM_SMTP_SECURE=false
PLATFORM_SMTP_USER=${user}
PLATFORM_SMTP_PASS=${pass}
EOF
    )
    chmod 600 "$PLATFORM_ENV_FILE"
    print_success "$PLATFORM_ENV_FILE angelegt (nur für den Besitzer lesbar)."
}
