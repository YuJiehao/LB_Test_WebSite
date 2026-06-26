.PHONY: auth-secret

# ---------------------------------------------------------------------------
#  auth-secret  —  Generate the htpasswd Secret for Ingress Basic Auth
#
#  Usage:
#    make auth-secret AUTH_PASSWORD=<password>
#
#  Requirements:
#    - apache2-utils (provides htpasswd, usually pre-installed on macOS / Linux)
#    - kubectl configured for the target cluster
#
#  The command:
#    1. Creates a bcrypt htpasswd entry for user `admin`.
#    2. Pipes it into `kubectl create secret generic` as the `auth` file.
#    3. Outputs the resulting YAML — pipe to `kubectl apply -f -` to apply.
#
#  Example:
#    make auth-secret AUTH_PASSWORD=s3cret | kubectl apply -f -
# ---------------------------------------------------------------------------
auth-secret:
	@if [ -z "$(AUTH_PASSWORD)" ]; then \
	  echo "ERROR: AUTH_PASSWORD is required. Usage: make auth-secret AUTH_PASSWORD=<password>"; \
	  exit 1; \
	fi
	htpasswd -nbB admin '$(AUTH_PASSWORD)' | \
	  kubectl create secret generic lb-control-plane-auth \
	    --from-file=auth=/dev/stdin \
	    --dry-run=client -o yaml
