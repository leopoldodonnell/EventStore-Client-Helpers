#!/bin/bash

# Text colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Debug mode
DEBUG=${DEBUG:-false}

# Interactive mode
INTERACTIVE=${INTERACTIVE:-false}

# Function to print section headers
print_header() {
    echo -e "\n${BLUE}=== $1 ===${NC}\n"
}

# Function to debug print
debug() {
    if [ "$DEBUG" = true ]; then
        echo -e "${YELLOW}DEBUG: $1${NC}" >&2
    fi
}

# Function to prompt for continuation
prompt_continue() {
    if [ "$INTERACTIVE" = true ]; then
        echo -e "\n${GREEN}Press Enter to continue...${NC}"
        read -r
    fi
}

# Function to handle command line arguments
handle_args() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --debug)
                DEBUG=true
                shift
                ;;
            --interactive)
                INTERACTIVE=true
                shift
                ;;
            *)
                echo "Unknown option: $1"
                echo "Usage: $0 [--debug] [--interactive]"
                exit 1
                ;;
        esac
    done
}

# Parse command line arguments
handle_args "$@"

# Function to check if server is running
check_server() {
    for i in {1..30}; do
        if curl -s "http://localhost:3000/health" > /dev/null; then
            echo -e "${GREEN}Server is running${NC}"
            return 0
        fi
        echo -e "${BLUE}Waiting for server to start... ($i/30)${NC}"
        sleep 1
    done
    echo -e "${RED}Server did not start within 30 seconds${NC}"
    exit 1
}

# Function to make API calls and format the response
call_api() {
    local method="$1"
    local endpoint="$2"
    local data="$3"
    local response=""
    local cleaned_response=""
    local url="http://localhost:3000$endpoint"
    
    debug "Full URL: $url"
    debug "URL components:"
    debug "  Method: $method"
    debug "  Endpoint: $endpoint"
    if [ -n "$data" ]; then
        debug "  Data: $data"
    fi
    
    # Build curl command
    local curl_cmd="curl -v -s -w '\n%{http_code}' -X $method '$url'"
    if [ -n "$data" ]; then
        curl_cmd="$curl_cmd -H 'Content-Type: application/json' -d '$data'"
    fi
    
    debug "Executing: $curl_cmd"
    
    # Execute curl command
    response=$(eval "$curl_cmd")
    local exit_code=$?
    debug "Curl exit code: $exit_code"
    debug "Raw response: '$response'"
    
    # Get HTTP status code (last line)
    local status_code=$(echo "$response" | tail -n1)
    debug "HTTP status code: $status_code"
    
    # Remove the status code from response
    cleaned_response=$(echo "$response" | sed \$d)
    debug "Cleaned response: '$cleaned_response'"
    debug "Response length: ${#cleaned_response}"
    debug "Response bytes: $(echo -n "$cleaned_response" | xxd -p)"
    
    # Format response if not empty
    if [ -n "$cleaned_response" ]; then
        debug "Cleaned response length: ${#cleaned_response}"
        debug "Cleaned response bytes: $(echo -n "$cleaned_response" | xxd -p)"
        
        if echo "$cleaned_response" | /opt/local/bin/jq '.' > /dev/null 2>&1; then
            echo "$cleaned_response" | /opt/local/bin/jq '.'
        else
            debug "JSON parsing failed, showing raw response"
            echo "$response"
            # Show the error from jq
            echo "$cleaned_response" | /opt/local/bin/jq '.' 2>&1 | sed 's/^/jq error: /'
        fi
    else
        debug "Empty response"
    fi
    
    # Return success if status code is 2xx
    if [ "$status_code" -ge 200 ] && [ "$status_code" -lt 300 ]; then
        return 0
    else
        return 1
    fi
}

# Enable debug mode for this run
DEBUG=false

# Start the demo
print_header "Example Bank API Demo"
prompt_continue

# Check if server is running
print_header "Checking Server Status"
check_server
prompt_continue

# Create a savings account
print_header "Creating a Savings Account"
savings_response=$(call_api "POST" "/accounts" '{
    "owner": "Alice Johnson",
    "initialBalance": 1000,
    "accountType": "savings"
}')

if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to create savings account${NC}"
    exit 1
fi

# Extract account ID from response
debug "Full savings response: '$savings_response'"
savings_id=$(echo "$savings_response" | /opt/local/bin/jq -r '.id // empty' 2>/dev/null)
debug "Extracted savings ID: $savings_id"

if [ -z "$savings_id" ]; then
    echo -e "${RED}Failed to get savings account ID from response: $savings_response${NC}"
    exit 1
fi
prompt_continue

# Create a checking account
print_header "Creating a Checking Account"
checking_response=$(call_api "POST" "/accounts" '{
    "owner": "Bob Smith",
    "initialBalance": 500,
    "accountType": "checking"
}')

if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to create checking account${NC}"
    exit 1
fi

# Extract account ID from response
debug "Full checking response: '$checking_response'"
checking_id=$(echo "$checking_response" | /opt/local/bin/jq -r '.id // empty' 2>/dev/null)
debug "Extracted checking ID: $checking_id"

if [ -z "$checking_id" ]; then
    echo -e "${RED}Failed to get checking account ID from response: $checking_response${NC}"
    exit 1
fi
prompt_continue

# View savings account details
print_header "Viewing Savings Account Details"
debug "Using savings_id: $savings_id"
call_api "GET" "/accounts/$savings_id"
prompt_continue

# Deposit money into savings
print_header "Depositing Money into Savings"
debug "Using savings_id: $savings_id"
call_api "POST" "/accounts/$savings_id/deposit" '{
    "amount": 250.50,
    "userId": "alice123",
    "description": "Birthday money"
}'
prompt_continue

# View updated savings balance
print_header "Viewing Updated Savings Balance"
debug "Using savings_id: $savings_id"
call_api "GET" "/accounts/$savings_id"
prompt_continue

# Withdraw from checking
print_header "Withdrawing from Checking Account"
debug "Using checking_id: $checking_id"
call_api "POST" "/accounts/$checking_id/withdraw" '{
    "amount": 100,
    "userId": "bob123",
    "description": "ATM withdrawal"
}'
prompt_continue

# View checking account details
print_header "Viewing Checking Account Details"
debug "Using checking_id: $checking_id"
call_api "GET" "/accounts/$checking_id"
prompt_continue

# Try to withdraw too much (should fail)
print_header "Attempting to Withdraw Too Much (Should Fail)"
debug "Using checking_id: $checking_id"
call_api "POST" "/accounts/$checking_id/withdraw" '{
    "amount": 1000,
    "userId": "bob123",
    "description": "This should fail"
}'
prompt_continue

# Make multiple deposits to trigger snapshot
print_header "Making Multiple Deposits to Trigger Snapshot"
prompt_continue

for i in {1..6}; do
    print_header "Deposit $i of 6"
    debug "Using savings_id: $savings_id"
    call_api "POST" "/accounts/$savings_id/deposit" "{
        \"amount\": 10,
        \"userId\": \"alice123\",
        \"description\": \"Deposit $i\"
    }"
    prompt_continue
done

# Final account states
print_header "Final Account States"
echo -e "${GREEN}Savings Account:${NC}"
debug "Using savings_id: $savings_id"
call_api "GET" "/accounts/$savings_id"
echo -e "${GREEN}Checking Account:${NC}"
debug "Using checking_id: $checking_id"
call_api "GET" "/accounts/$checking_id"

print_header "Demo Complete"
