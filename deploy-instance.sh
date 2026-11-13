#!/bin/bash

# Script to deploy multiple instances of OpenBills
# Interactive deployment with guided configuration

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

# Function to prompt for input with default value
prompt_input() {
    local prompt="$1"
    local default="$2"
    local result
    
    if [ -n "$default" ]; then
        read -p "$(echo -e "${BLUE}$prompt${NC} [${GREEN}$default${NC}]: ")" result
        echo "${result:-$default}"
    else
        read -p "$(echo -e "${BLUE}$prompt${NC}: ")" result
        echo "$result"
    fi
}

# Function to prompt for password (hidden input)
prompt_password() {
    local prompt="$1"
    local default="$2"
    local result
    
    if [ -n "$default" ]; then
        read -s -p "$(echo -e "${BLUE}$prompt${NC} [${GREEN}verwende Standard${NC}]: ")" result
        echo
        echo "${result:-$default}"
    else
        read -s -p "$(echo -e "${BLUE}$prompt${NC}: ")" result
        echo
        echo "$result"
    fi
}

# Gültige Tarife (leer = self-hosted, unbegrenzt). Muss zu backend/utils/plan.js passen.
VALID_PLANS="free starter professional enterprise"

is_valid_plan() {
    local plan="$1" p
    [ -z "$plan" ] && return 0
    for p in $VALID_PLANS; do
        [ "$p" = "$plan" ] && return 0
    done
    return 1
}

# Tarif interaktiv abfragen; setzt OPENBILLS_PLAN und OPENBILLS_UPGRADE_CONTACT
prompt_plan() {
    echo
    print_info "=== Tarif-Konfiguration ==="
    print_info "Self-Hosted = alle Funktionen, keine Limits. Tarife nur für Managed-SaaS-Instanzen."
    echo "  1) Self-Hosted (Standard)"
    echo "  2) Free          –   5 Rechnungen/Angebote pro Monat,  10 Kunden"
    echo "  3) Starter       –  25 Rechnungen/Angebote pro Monat,  50 Kunden, E-Mail, Mahnwesen"
    echo "  4) Professional  – 100 Rechnungen/Angebote pro Monat, 250 Kunden, alle Funktionen"
    echo "  5) Enterprise    – unbegrenzt, alle Funktionen"
    while true; do
        local choice
        choice=$(prompt_input "Tarif wählen (1-5)" "1")
        case "$choice" in
            1) OPENBILLS_PLAN=""; break ;;
            2) OPENBILLS_PLAN="free"; break ;;
            3) OPENBILLS_PLAN="starter"; break ;;
            4) OPENBILLS_PLAN="professional"; break ;;
            5) OPENBILLS_PLAN="enterprise"; break ;;
            *) print_error "Bitte 1 bis 5 eingeben." ;;
        esac
    done

    OPENBILLS_UPGRADE_CONTACT=""
    if [ -n "$OPENBILLS_PLAN" ]; then
        OPENBILLS_UPGRADE_CONTACT=$(prompt_input "Kontakt für Upgrade-Hinweis (E-Mail, Telefon oder URL, optional)" "")
    fi
}

# Function to check if port is available
check_port() {
    local port=$1
    if netstat -tuln 2>/dev/null | grep -q ":${port} " || lsof -i :${port} >/dev/null 2>&1; then
        return 1
    fi
    return 0
}

# Function to find next available port
find_available_port() {
    local start_port=$1
    local port=$start_port
    
    while ! check_port $port; do
        ((port++))
    done
    echo $port
}

# Function to collect instance configuration
collect_instance_config() {
    echo
    print_info "=== OpenBills Instance Deployment ==="
    echo
    print_info "Dieses Skript führt Sie durch die Konfiguration einer neuen OpenBills-Instanz."
    echo
    
    # Instance name
    while true; do
        INSTANCE_NAME=$(prompt_input "Name der Instanz (z.B. 'client1', 'firma-mustermann')" "")
        if [ -n "$INSTANCE_NAME" ]; then
            # Check if instance already exists
            if [ -f ".env.${INSTANCE_NAME}" ]; then
                print_warning "Eine Instanz mit dem Namen '$INSTANCE_NAME' existiert bereits."
                read -p "$(echo -e "${YELLOW}Möchten Sie diese überschreiben? (y/N)${NC}: ")" -n 1 -r
                echo
                if [[ $REPLY =~ ^[Yy]$ ]]; then
                    break
                fi
            else
                break
            fi
        else
            print_error "Der Instanzname darf nicht leer sein."
        fi
    done
    
    echo
    print_info "=== Port-Konfiguration ==="
    print_info "Ports werden automatisch überprüft und falls belegt, wird der nächste freie Port vorgeschlagen."
    echo
    
    # Database port
    DEFAULT_DB_PORT=5432
    SUGGESTED_DB_PORT=$(find_available_port $DEFAULT_DB_PORT)
    DB_PORT=$(prompt_input "Datenbank Port" "$SUGGESTED_DB_PORT")
    
    # Backend port
    DEFAULT_BACKEND_PORT=3001
    SUGGESTED_BACKEND_PORT=$(find_available_port $DEFAULT_BACKEND_PORT)
    BACKEND_PORT=$(prompt_input "Backend API Port" "$SUGGESTED_BACKEND_PORT")
    
    # Frontend port
    DEFAULT_FRONTEND_PORT=8080
    SUGGESTED_FRONTEND_PORT=$(find_available_port $DEFAULT_FRONTEND_PORT)
    FRONTEND_PORT=$(prompt_input "Frontend Web Port" "$SUGGESTED_FRONTEND_PORT")
    
    # Validate ports are not conflicting
    if [ "$DB_PORT" = "$BACKEND_PORT" ] || [ "$DB_PORT" = "$FRONTEND_PORT" ] || [ "$BACKEND_PORT" = "$FRONTEND_PORT" ]; then
        print_error "Ports dürfen nicht identisch sein!"
        return 1
    fi

    prompt_plan
    

    
    # Generate secure random passwords
    DB_PASSWORD="secure_db_${INSTANCE_NAME}_$(openssl rand -hex 16)"
    
    return 0
}

# Function to deploy an instance
deploy_instance() {
    echo
    print_info "=== Deployment wird gestartet ==="
    echo
    print_info "Instance Name: $INSTANCE_NAME"
    print_info "Database Port: $DB_PORT"
    print_info "Backend Port: $BACKEND_PORT" 
    print_info "Frontend Port: $FRONTEND_PORT"
    print_info "Tarif: ${OPENBILLS_PLAN:-self-hosted}"
    echo
    
    # Final confirmation
    read -p "$(echo -e "${YELLOW}Soll das Deployment gestartet werden? (y/N)${NC}: ")" -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_warning "Deployment abgebrochen."
        return 1
    fi
    
    # Create Docker Compose environment file
    print_info "Erstelle Docker Compose Konfiguration..."
    cat > .env.${INSTANCE_NAME} << EOF
COMPOSE_PROJECT_NAME=openbills-${INSTANCE_NAME}
INSTANCE_NAME=${INSTANCE_NAME}
DB_PORT=${DB_PORT}
BACKEND_PORT=${BACKEND_PORT}
FRONTEND_PORT=${FRONTEND_PORT}
POSTGRES_DB=openbills_${INSTANCE_NAME}
POSTGRES_USER=rm_user_${INSTANCE_NAME}
POSTGRES_PASSWORD=${DB_PASSWORD}
EOF

    # Create Backend environment file
    print_info "Erstelle Backend Konfiguration..."
    cat > .env.backend.${INSTANCE_NAME} << EOF
PORT=3001
DB_HOST=database
DB_PORT=5432
DB_NAME=openbills_${INSTANCE_NAME}
DB_USER=rm_user_${INSTANCE_NAME}
DB_PASSWORD=${DB_PASSWORD}
NODE_ENV=production

# Managed SaaS: free | starter | professional | enterprise (leer = self-hosted, unbegrenzt)
OPENBILLS_PLAN=${OPENBILLS_PLAN}
# Kontakt im Upgrade-Hinweis (E-Mail, Telefon oder URL)
OPENBILLS_UPGRADE_CONTACT=${OPENBILLS_UPGRADE_CONTACT}
EOF

    # Start deployment
    print_info "Starte Docker Container..."
    if docker compose --env-file .env.${INSTANCE_NAME} -f docker-compose.yml up -d --build; then
        echo
        print_success "Instance '$INSTANCE_NAME' wurde erfolgreich deployed!"
        echo
        print_info "=== Zugriffsinformationen ==="
        print_success "Frontend:     http://localhost:$FRONTEND_PORT"
        print_success "Backend API:  http://localhost:$BACKEND_PORT"
        print_success "Datenbank:    localhost:$DB_PORT"
        echo
        print_info "=== Konfigurationsdateien ==="
        print_info "Docker Compose: .env.${INSTANCE_NAME}"
        print_info "Backend:        .env.backend.${INSTANCE_NAME}"
        echo
        print_info "=== Nächste Schritte ==="
        print_info "1. Öffnen Sie http://localhost:$FRONTEND_PORT im Browser"
        print_info "2. Konfigurieren Sie Ihre Firma in den Einstellungen"
        print_info "3. Erstellen Sie Ihre ersten Kunden und Rechnungen"
        echo
        print_warning "Wichtig: Bewahren Sie die Konfigurationsdateien sicher auf!"
        print_warning "Database Password: $DB_PASSWORD"
    else
        print_error "Deployment fehlgeschlagen!"
        return 1
    fi
}

# Main script logic
main() {
    # Check for dependencies
    print_info "Überprüfe Systemvoraussetzungen..."
    
    # Check if Docker is installed and running
    if ! command -v docker &> /dev/null; then
        print_error "Docker ist nicht installiert. Bitte installieren Sie Docker Desktop."
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        print_error "Docker läuft nicht. Bitte starten Sie Docker Desktop."
        exit 1
    fi
    
    # Check if docker compose is available
    if ! docker compose version &> /dev/null; then
        print_error "Docker Compose ist nicht verfügbar."
        exit 1
    fi
    
    print_success "Alle Systemvoraussetzungen erfüllt."
    
    # Interactive mode if no arguments provided or with --interactive flag
    if [ $# -eq 0 ]; then
        collect_instance_config
        if [ $? -eq 0 ]; then
            deploy_instance
        fi
    else
        # Parse command line arguments
        case "$1" in
            --help|-h)
                show_help
                ;;
            --interactive|-i)
                collect_instance_config
                if [ $? -eq 0 ]; then
                    deploy_instance
                fi
                ;;
            --legacy)
                # Legacy mode with explicit flag
                shift # Remove --legacy from arguments
                legacy_deploy "$@"
                ;;
            *)
                print_error "Unbekanntes Argument: $1"
                echo
                print_info "Verfügbare Optionen:"
                print_info "  (keine Argumente)    - Interaktiver Modus (Standard)"
                print_info "  --interactive, -i    - Interaktiver Modus"
                print_info "  --legacy            - Legacy-Modus"
                print_info "  --help, -h          - Hilfe anzeigen"
                echo
                exit 1
                ;;
        esac
    fi
}

# Function to show help
show_help() {
    echo
    print_info "=== OpenBills Deployment Script ==="
    echo
    echo "Usage:"
    echo "  $0                        # Interaktiver Modus (Standard, empfohlen)"
    echo "  $0 -i, --interactive      # Interaktiver Modus"
    echo "  $0 --legacy <args>        # Legacy-Modus mit explizitem Flag"
    echo "  $0 -h, --help             # Diese Hilfe anzeigen"
    echo
    echo "Legacy Modus (für Kompatibilität):"
    echo "  $0 --legacy <instance_name> [db_port] [backend_port] [frontend_port] [plan]"
    echo "      plan: free | starter | professional | enterprise (weglassen = self-hosted)"
    echo
    echo "Beispiele:"
    echo "  $0                        # Startet interaktiven Modus (Standard)"
    echo "  $0 --interactive          # Startet interaktiven Modus"
    echo "  $0 --legacy client1 5432 3001 8080"
    echo "  $0 --legacy client2 5433 3002 8081"
    echo "  $0 --legacy client3 5434 3003 8082 starter"
    echo
    print_info "Der interaktive Modus läuft standardmäßig und ist empfohlen, da er eine"
    print_info "vollständige E-Mail-Konfiguration und Validierung bietet."
    echo
}

# Legacy deployment function for backwards compatibility
legacy_deploy() {
    print_warning "Verwende Legacy-Modus (mit --legacy aufgerufen). Für vollständige Konfiguration verwenden Sie den Standard-Modus ohne Argumente."
    
    # Check if instance name is provided
    if [ -z "$1" ]; then
        show_help
        exit 1
    fi

    # Set default ports if not provided
    INSTANCE_NAME=$1
    DB_PORT=${2:-5432}
    BACKEND_PORT=${3:-3001}
    FRONTEND_PORT=${4:-8080}
    OPENBILLS_PLAN=${5:-}
    OPENBILLS_UPGRADE_CONTACT=""

    if ! is_valid_plan "$OPENBILLS_PLAN"; then
        print_error "Unbekannter Tarif '$OPENBILLS_PLAN'. Erlaubt: $VALID_PLANS (oder weglassen für self-hosted)."
        exit 1
    fi

    # Check if ports are already in use
    if ! check_port $DB_PORT; then
        print_error "Port $DB_PORT ist bereits belegt!"
        exit 1
    fi

    if ! check_port $BACKEND_PORT; then
        print_error "Port $BACKEND_PORT ist bereits belegt!"
        exit 1
    fi

    if ! check_port $FRONTEND_PORT; then
        print_error "Port $FRONTEND_PORT ist bereits belegt!"
        exit 1
    fi

    # Generate secure password
    DB_PASSWORD="secure_password_${INSTANCE_NAME}_$(date +%s)"
    
    # Create minimal configuration (no SMTP)
    cat > .env.${INSTANCE_NAME} << EOF
COMPOSE_PROJECT_NAME=openbills-${INSTANCE_NAME}
INSTANCE_NAME=${INSTANCE_NAME}
DB_PORT=${DB_PORT}
BACKEND_PORT=${BACKEND_PORT}
FRONTEND_PORT=${FRONTEND_PORT}
POSTGRES_DB=openbills_${INSTANCE_NAME}
POSTGRES_USER=rm_user_${INSTANCE_NAME}
POSTGRES_PASSWORD=${DB_PASSWORD}
EOF

    # Create minimal backend config
    cat > .env.backend.${INSTANCE_NAME} << EOF
PORT=3001
DB_HOST=database
DB_PORT=5432
DB_NAME=openbills_${INSTANCE_NAME}
DB_USER=rm_user_${INSTANCE_NAME}
DB_PASSWORD=${DB_PASSWORD}
NODE_ENV=production

# Managed SaaS: free | starter | professional | enterprise (leer = self-hosted, unbegrenzt)
OPENBILLS_PLAN=${OPENBILLS_PLAN}
# Kontakt im Upgrade-Hinweis (E-Mail, Telefon oder URL)
OPENBILLS_UPGRADE_CONTACT=${OPENBILLS_UPGRADE_CONTACT}
EOF

    # Deploy with specific env file
    if docker compose --env-file .env.${INSTANCE_NAME} -f docker-compose.yml up -d --build; then
        print_success "Instance '$INSTANCE_NAME' deployed successfully!"
        print_info "Frontend available at: http://localhost:$FRONTEND_PORT"
        print_info "Backend API available at: http://localhost:$BACKEND_PORT"
        print_info "Database available at: localhost:$DB_PORT"
        print_info "Tarif: ${OPENBILLS_PLAN:-self-hosted}"
        if [ -n "$OPENBILLS_PLAN" ]; then
            print_info "Upgrade-Kontakt bei Bedarf in .env.backend.${INSTANCE_NAME} setzen (OPENBILLS_UPGRADE_CONTACT)."
        fi
        print_warning "E-Mail-Funktionen sind im Legacy-Modus nicht konfiguriert."
        print_info "Verwenden Sie das Script ohne --legacy Flag für vollständige Konfiguration."
    else
        print_error "Deployment fehlgeschlagen!"
        exit 1
    fi
}

# Run main function
main "$@"
