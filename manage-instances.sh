#!/bin/bash

# Script to manage multiple OpenBills instances

# Colors for better output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Plattform-Mailversand (Tarife free/starter/professional), siehe scripts/platform.sh
# shellcheck source=scripts/platform.sh
source "$(dirname "$0")/scripts/platform.sh"

# Function to list all running instances
list_instances() {
    echo
    print_info "=== Laufende OpenBills Instanzen ==="
    echo
    
    # Get all running containers with openbills in name
    containers=$(docker ps --filter "name=openbills-" --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}")
    
    if [ "$(echo "$containers" | wc -l)" -eq 1 ]; then
        print_warning "Keine laufenden Instanzen gefunden."
    else
        echo "$containers"
    fi
    
    echo
    print_info "=== Verfügbare Konfigurationen ==="
    for env_file in .env.*; do
        if [ -f "$env_file" ] && [[ "$env_file" != .env.backend.* ]]; then
            instance_name=$(echo "$env_file" | sed 's/.env.//')
            if [ -f ".env.backend.$instance_name" ]; then
                # Get ports from env file
                DB_PORT=$(grep "DB_PORT=" "$env_file" | cut -d'=' -f2)
                BACKEND_PORT=$(grep "BACKEND_PORT=" "$env_file" | cut -d'=' -f2)
                FRONTEND_PORT=$(grep "FRONTEND_PORT=" "$env_file" | cut -d'=' -f2)
                # Tarif aus der Backend-Konfiguration (leer/fehlend = self-hosted)
                PLAN=$(grep -E '^OPENBILLS_PLAN=' ".env.backend.$instance_name" | tail -1 | cut -d'=' -f2- | tr -d '"'"'"'\r ')
                
                PUBLIC_URL=$(grep -E '^PUBLIC_URL=' ".env.backend.$instance_name" | tail -1 | cut -d'=' -f2- | tr -d '"'"'"'\r ')

                # Check if running
                if docker ps --filter "name=openbills-${instance_name}" --format "{{.Names}}" | grep -q "openbills-${instance_name}"; then
                    status="${GREEN}RUNNING${NC}"
                else
                    status="${RED}STOPPED${NC}"
                fi
                
                echo -e "  ${BLUE}$instance_name${NC} - $status - Tarif:${PLAN:-self-hosted} - URL:${PUBLIC_URL:--} - Frontend:$FRONTEND_PORT Backend:$BACKEND_PORT DB:$DB_PORT"
            fi
        fi
    done
}

# Function to stop an instance
stop_instance() {
    local instance_name=$1
    if [ -z "$instance_name" ]; then
        print_error "Bitte geben Sie den Instanznamen an"
        echo "Usage: $0 stop <instance_name>"
        return 1
    fi
    
    if [ ! -f ".env.${instance_name}" ]; then
        print_error "Instanz '$instance_name' nicht gefunden"
        return 1
    fi
    
    print_info "Stoppe Instanz: $instance_name"
    compose_cmd "$instance_name"
    if "${COMPOSE[@]}" down; then
        print_success "Instanz '$instance_name' wurde gestoppt"
    else
        print_error "Fehler beim Stoppen der Instanz '$instance_name'"
        return 1
    fi
}

# Function to start an instance
start_instance() {
    local instance_name=$1
    if [ -z "$instance_name" ]; then
        print_error "Bitte geben Sie den Instanznamen an"
        echo "Usage: $0 start <instance_name>"
        return 1
    fi
    
    if [ ! -f ".env.${instance_name}" ]; then
        print_error "Konfigurationsdatei .env.${instance_name} nicht gefunden"
        return 1
    fi
    
    if [ ! -f ".env.backend.${instance_name}" ]; then
        print_warning "Backend-Konfigurationsdatei .env.backend.${instance_name} nicht gefunden"
        print_info "Erstelle minimale Backend-Konfiguration..."
        
        # Get database config from main env file
        DB_NAME=$(grep "POSTGRES_DB=" ".env.${instance_name}" | cut -d'=' -f2)
        DB_USER=$(grep "POSTGRES_USER=" ".env.${instance_name}" | cut -d'=' -f2)
        DB_PASSWORD=$(grep "POSTGRES_PASSWORD=" ".env.${instance_name}" | cut -d'=' -f2)
        FRONTEND_PORT=$(grep "FRONTEND_PORT=" ".env.${instance_name}" | cut -d'=' -f2)

        cat > .env.backend.${instance_name} << EOF
PORT=3001
DB_HOST=database
DB_PORT=5432
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
NODE_ENV=production
AUTH_ENCRYPTION_KEY=$(openssl rand -base64 32)
TRUST_PROXY_HOPS=2
PUBLIC_URL=http://localhost:${FRONTEND_PORT}
EOF
        print_warning "PUBLIC_URL wurde auf http://localhost:${FRONTEND_PORT} gesetzt. Bitte per './manage-instances.sh config ${instance_name}' auf die echte URL ändern."
    fi
    
    check_platform_ready "$instance_name" || return 1

    print_info "Starte Instanz: $instance_name"
    compose_cmd "$instance_name"
    if "${COMPOSE[@]}" up -d --build; then
        print_success "Instanz '$instance_name' wurde gestartet"
        
        # Show access information
        FRONTEND_PORT=$(grep "FRONTEND_PORT=" ".env.${instance_name}" | cut -d'=' -f2)
        BACKEND_PORT=$(grep "BACKEND_PORT=" ".env.${instance_name}" | cut -d'=' -f2)
        
        echo
        print_info "=== Zugriffsinformationen ==="
        print_success "Frontend: http://localhost:$FRONTEND_PORT"
        print_success "Backend:  http://localhost:$BACKEND_PORT"
    else
        print_error "Fehler beim Starten der Instanz '$instance_name'"
        return 1
    fi
}

# Baut Backend- und Frontend-Image einmal und startet alle laufenden Instanzen damit neu.
# Die Images haben keine instanzspezifischen Build-Args, daher genügt ein Build; er wird auf die
# Compose-Standardnamen <projekt>-backend/-frontend jeder Instanz getaggt.
restart_all() {
    local only=${1:-} names=() env_file name
    for env_file in .env.*; do
        [[ "$env_file" == .env.backend.* ]] && continue
        name=${env_file#.env.}
        [ -n "$only" ] && [ "$name" != "$only" ] && continue
        [ -f ".env.backend.$name" ] || continue
        compose_cmd "$name"
        if [ -n "$("${COMPOSE[@]}" ps --status running -q 2>/dev/null)" ]; then
            names+=("$name")
        fi
    done

    if [ ${#names[@]} -eq 0 ]; then
        print_warning "Keine laufenden Instanzen gefunden."
        return 0
    fi
    print_info "Laufende Instanzen: ${names[*]}"

    for name in "${names[@]}"; do
        check_platform_ready "$name" || return 1
    done

    print_info "Baue Backend-Image..."
    docker build -t openbills-build-backend ./backend || { print_error "Backend-Build fehlgeschlagen"; return 1; }
    print_info "Baue Frontend-Image..."
    docker build -t openbills-build-frontend . || { print_error "Frontend-Build fehlgeschlagen"; return 1; }

    local failed=() project
    for name in "${names[@]}"; do
        print_info "Aktualisiere Instanz '$name'..."
        project=$(grep -E '^COMPOSE_PROJECT_NAME=' ".env.${name}" | tail -1 | cut -d'=' -f2- | tr -d '"'"'"'\r ')
        project=${project:-openbills-$name}
        docker tag openbills-build-backend "${project}-backend"
        docker tag openbills-build-frontend "${project}-frontend"
        compose_cmd "$name"
        # Ohne --force-recreate: Compose erstellt nur Container neu, deren Image/Konfiguration sich geändert hat
        if "${COMPOSE[@]}" up -d --no-build; then
            print_success "Instanz '$name' aktualisiert (unveränderte Dienste blieben unberührt)"
        else
            print_error "Fehler beim Neustart von '$name'"
            failed+=("$name")
        fi
    done

    if [ ${#failed[@]} -gt 0 ]; then
        print_error "Fehlgeschlagen: ${failed[*]}"
        return 1
    fi
    print_success "Alle ${#names[@]} Instanzen aktualisiert"
}

# Function to remove an instance completely
remove_instance() {
    local instance_name=$1
    local assume_yes=${2:-}
    if [ -z "$instance_name" ]; then
        print_error "Bitte geben Sie den Instanznamen an"
        echo "Usage: $0 remove <instance_name>"
        return 1
    fi
    
    if [ ! -f ".env.${instance_name}" ]; then
        print_error "Instanz '$instance_name' nicht gefunden"
        return 1
    fi
    
    echo
    print_warning "=== ACHTUNG: DATENVERLUST ==="
    print_warning "Dies wird die Instanz '$instance_name' vollständig entfernen!"
    print_warning "Alle Daten (Datenbank, Konfiguration) gehen verloren!"
    echo
    if [ "$assume_yes" = "--yes" ]; then
        confirmation="LÖSCHEN"
    else
        read -p "$(echo -e "${RED}Sind Sie sicher? Geben Sie 'LÖSCHEN' ein um zu bestätigen${NC}: ")" confirmation
    fi
    
    if [ "$confirmation" = "LÖSCHEN" ]; then
        print_info "Entferne Instanz: $instance_name"
        
        # Stop and remove containers with volumes
        compose_cmd "$instance_name"
        "${COMPOSE[@]}" down -v
        
        # Remove configuration files
        rm -f .env.${instance_name}
        rm -f .env.backend.${instance_name}
        
        print_success "Instanz '$instance_name' wurde vollständig entfernt"
    else
        print_info "Vorgang abgebrochen"
    fi
}

# Function to show logs for an instance
logs_instance() {
    local instance_name=$1
    local service=${2:-""}
    
    if [ -z "$instance_name" ]; then
        print_error "Bitte geben Sie den Instanznamen an"
        echo "Usage: $0 logs <instance_name> [service]"
        return 1
    fi
    
    if [ ! -f ".env.${instance_name}" ]; then
        print_error "Instanz '$instance_name' nicht gefunden"
        return 1
    fi
    
    print_info "Zeige Logs für Instanz: $instance_name"
    if [ -n "$service" ]; then
        print_info "Service: $service"
        compose_cmd "$instance_name"
        "${COMPOSE[@]}" logs -f $service
    else
        compose_cmd "$instance_name"
        "${COMPOSE[@]}" logs -f
    fi
}

# Function to backup instance data
backup_instance() {
    local instance_name=$1
    if [ -z "$instance_name" ]; then
        print_error "Bitte geben Sie den Instanznamen an"
        echo "Usage: $0 backup <instance_name>"
        return 1
    fi
    
    if [ ! -f ".env.${instance_name}" ]; then
        print_error "Instanz '$instance_name' nicht gefunden"
        return 1
    fi
    
    # Get database configuration
    DB_NAME=$(grep "POSTGRES_DB=" ".env.${instance_name}" | cut -d'=' -f2)
    DB_USER=$(grep "POSTGRES_USER=" ".env.${instance_name}" | cut -d'=' -f2)
    
    local backup_dir="backups"
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="${backup_dir}/backup_${instance_name}_${timestamp}.sql"
    local container_name="openbills-${instance_name}-db"
    
    # Create backup directory if it doesn't exist
    mkdir -p "$backup_dir"
    
    print_info "Erstelle Backup für Instanz: $instance_name"
    print_info "Backup wird gespeichert als: $backup_file"
    
    if docker exec "$container_name" pg_dump -U "$DB_USER" "$DB_NAME" > "$backup_file"; then
        # Also backup configuration files
        cp ".env.${instance_name}" "${backup_dir}/env_${instance_name}_${timestamp}"
        if [ -f ".env.backend.${instance_name}" ]; then
            cp ".env.backend.${instance_name}" "${backup_dir}/env_backend_${instance_name}_${timestamp}"
        fi
        
        print_success "Backup erfolgreich erstellt!"
        print_info "Dateien:"
        print_info "  - Datenbank: $backup_file"
        print_info "  - Konfiguration: ${backup_dir}/env_${instance_name}_${timestamp}"
        if [ -f ".env.backend.${instance_name}" ]; then
            print_info "  - Backend-Konfiguration: ${backup_dir}/env_backend_${instance_name}_${timestamp}"
        fi
    else
        print_error "Backup fehlgeschlagen!"
        return 1
    fi
}

# Function to edit instance configuration
edit_config() {
    local instance_name=$1
    if [ -z "$instance_name" ]; then
        print_error "Bitte geben Sie den Instanznamen an"
        echo "Usage: $0 config <instance_name>"
        return 1
    fi
    
    if [ ! -f ".env.backend.${instance_name}" ]; then
        print_error "Backend-Konfigurationsdatei .env.backend.${instance_name} nicht gefunden"
        return 1
    fi
    
    print_info "Öffne Konfigurationsdatei für Instanz: $instance_name"
    print_warning "Nach Änderungen muss die Instanz neu gestartet werden!"
    
    # Try to open with preferred editor
    if command -v code &> /dev/null; then
        code ".env.backend.${instance_name}"
    elif command -v nano &> /dev/null; then
        nano ".env.backend.${instance_name}"
    elif command -v vim &> /dev/null; then
        vim ".env.backend.${instance_name}"
    else
        print_error "Kein unterstützter Editor gefunden (code, nano, vim)"
        return 1
    fi
    
    echo
    read -p "$(echo -e "${YELLOW}Möchten Sie die Instanz jetzt neu starten? (y/N)${NC}: ")" -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        stop_instance "$instance_name"
        start_instance "$instance_name"
    fi
}

# Führt ein Auth-Skript im Backend-Container aus (onboarding.js / operator.js)
run_auth_script() {
    local instance_name=$1
    local script=$2
    local usage=$3
    shift 3
    local extra_args=("$@")
    if [ -z "$instance_name" ]; then
        print_error "Bitte geben Sie den Instanznamen an"
        echo "Usage: $0 $usage <instance_name>"
        return 1
    fi

    if [ ! -f ".env.${instance_name}" ]; then
        print_error "Instanz '$instance_name' nicht gefunden"
        return 1
    fi

    if is_demo_instance "$instance_name"; then
        print_error "Demo-Instanz: kein Onboarding/Support-Zugang (Login: demo@openbills.de / demo)"
        return 1
    fi

    compose_cmd "$instance_name"
    local compose=("${COMPOSE[@]}")
    if [ -z "$("${compose[@]}" ps --status running -q backend 2>/dev/null)" ]; then
        print_error "Das Backend von Instanz '$instance_name' läuft nicht. Zuerst starten: $0 start $instance_name"
        return 1
    fi

    if [ "${extra_args[0]:-}" = "--send-to" ]; then
        # Mailversand: .env.platform per stdin (nur hier), da Enterprise-Container sie nicht eingebunden haben
        "${compose[@]}" exec -T -e LOG_LEVEL=WARN backend node "scripts/${script}.js" "${extra_args[@]}" < "$PLATFORM_ENV_FILE"
    else
        "${compose[@]}" exec -T -e LOG_LEVEL=WARN backend node "scripts/${script}.js"
    fi
}

# Neuen Onboarding-Link erzeugen, optional per Mail senden (--send-to <email>)
onboarding_link() {
    local name="$1" flag="${2:-}" email="${3:-}"
    if [ -z "$flag" ]; then
        run_auth_script "$name" onboarding onboarding-link
        return
    fi
    if [ "$flag" != "--send-to" ] || [ -z "$email" ]; then
        print_error "Usage: $0 onboarding-link <instance_name> [--send-to <email>]"
        return 1
    fi
    local send_args
    send_args=$(onboarding_send_args "$name") || return 1
    run_auth_script "$name" onboarding onboarding-link --send-to "$email" $send_args
}

# Support-Zugang anlegen bzw. Passwort zurücksetzen
operator_reset() {
    run_auth_script "$1" operator operator-reset
}

# Tarif einer Instanz ändern (Upgrade/Downgrade): OPENBILLS_PLAN in .env.backend.<name> setzen, Instanz neu starten.
# Daten bleiben erhalten. Demo- und Self-hosted-Instanzen werden nicht umgestellt.
set_plan() {
    local name=$1 plan=$2 valid="free starter professional enterprise" current
    if [ -z "$name" ] || [ -z "$plan" ]; then
        print_error "Usage: $0 set-plan <instance_name> <${valid// /|}>"
        return 1
    fi
    if [ ! -f ".env.backend.${name}" ]; then
        print_error "Instanz '$name' nicht gefunden"
        return 1
    fi
    if ! [[ " $valid " == *" $plan "* ]]; then
        print_error "Unbekannter Tarif '$plan'. Erlaubt: $valid"
        return 1
    fi
    if is_demo_instance "$name"; then
        print_error "Demo-Instanz: Tarifwechsel nicht möglich"
        return 1
    fi
    current=$(instance_plan "$name")
    if [ -z "$current" ]; then
        print_error "Self-hosted-Instanz (kein Tarif): Tarifwechsel nicht möglich"
        return 1
    fi
    if [ "$current" = "$plan" ]; then
        print_info "Instanz '$name' hat bereits den Tarif '$plan'"
        return 0
    fi
    print_info "Tarifwechsel '$name': $current → $plan"
    cp ".env.backend.${name}" ".env.backend.${name}.bak"
    sed -i.tmp -E "s/^OPENBILLS_PLAN=.*/OPENBILLS_PLAN=${plan}/" ".env.backend.${name}" && rm -f ".env.backend.${name}.tmp"
    check_platform_ready "$name" || return 1
    compose_cmd "$name"
    if "${COMPOSE[@]}" up -d --force-recreate backend; then
        print_success "Instanz '$name' läuft jetzt mit Tarif '$plan'"
    else
        print_error "Neustart von '$name' fehlgeschlagen (Sicherung: .env.backend.${name}.bak)"
        return 1
    fi
}

# Neuesten Stand holen (git pull, nur fast-forward) und Instanzen aktualisieren: "all" oder eine bestimmte Instanz.
update_instances() {
    local target=$1
    if [ -z "$target" ]; then
        print_error "Usage: $0 update <instance_name|all>"
        return 1
    fi
    if [ "$target" != "all" ] && [ ! -f ".env.${target}" ]; then
        print_error "Instanz '$target' nicht gefunden"
        return 1
    fi
    print_info "git pull..."
    git pull --ff-only || { print_error "git pull fehlgeschlagen (lokale Änderungen oder Divergenz?)"; return 1; }
    if [ "$target" = "all" ]; then
        restart_all
    else
        restart_all "$target"
    fi
}

# Main script logic
case "$1" in
    list|ls)
        list_instances
        ;;
    start)
        start_instance $2
        ;;
    stop)
        stop_instance $2
        ;;
    restart)
        if [ "$2" = "all" ]; then
            restart_all || exit 1
        elif [ -n "$2" ]; then
            print_info "Starte Instanz '$2' neu..."
            check_platform_ready "$2" || exit 1
            stop_instance $2
            start_instance $2
        else
            print_error "Bitte geben Sie den Instanznamen an"
        fi
        ;;
    remove|delete)
        remove_instance "$2" "$3"
        ;;
    set-plan)
        set_plan "$2" "$3" || exit 1
        ;;
    update)
        update_instances "$2" || exit 1
        ;;
    logs)
        logs_instance $2 $3
        ;;
    backup)
        backup_instance $2
        ;;
    config|edit)
        edit_config $2
        ;;
    onboarding-link)
        onboarding_link "$2" "$3" "$4"
        ;;
    operator-reset)
        operator_reset $2
        ;;
    --help|-h|help)
        echo
        print_info "=== OpenBills Instance Manager ==="
        echo
        echo "Usage: $0 {command} [instance_name] [options]"
        echo
        echo "Commands:"
        echo "  list, ls                - Alle Instanzen auflisten"
        echo "  start <instance>        - Instanz starten"
        echo "  stop <instance>         - Instanz stoppen"
        echo "  restart <instance>      - Instanz neu starten"
        echo "  restart all             - Einmal bauen, alle laufenden Instanzen mit neuem Image neu starten"
        echo "  remove <instance> [--yes] - Instanz löschen (⚠️  Datenverlust!), --yes ohne Rückfrage"
        echo "  set-plan <inst> <plan>  - Tarif wechseln (Upgrade/Downgrade), Daten bleiben erhalten"
        echo "  update <inst|all>       - git pull, dann Instanz(en) neu bauen und aktualisieren"
        echo "  logs <instance> [svc]   - Logs anzeigen"
        echo "  backup <instance>       - Datenbank-Backup erstellen"
        echo "  config <instance>       - Konfiguration bearbeiten"
        echo "  onboarding-link <inst> [--send-to <email>]"
        echo "                          - Neuen Onboarding-Link erzeugen, optional per Mail an den Kunden senden"
        echo "  operator-reset <inst>   - Support-Zugang anlegen / Passwort zurücksetzen"
        echo "  help                    - Diese Hilfe anzeigen"
        echo
        echo "Beispiele:"
        echo "  $0 list"
        echo "  $0 start client1"
        echo "  $0 logs client1 backend"
        echo "  $0 backup client1"
        echo "  $0 config client1"
        echo "  $0 onboarding-link client1"
        echo "  $0 onboarding-link client1 --send-to kunde@example.com"
        echo
        ;;
    *)
        print_error "Unbekannter Befehl: $1"
        echo
        echo "Verwenden Sie '$0 help' für eine Liste aller verfügbaren Befehle."
        exit 1
        ;;
esac
