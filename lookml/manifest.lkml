project_name: "ca_cap"

# Extensión de administración del tope de tokens.
# Desarrollo local: sustituye "file:" por  url: "https://localhost:8080/bundle.js"
application: ca_cap_admin {
  label: "Tope de tokens · Conversational Analytics"
  file: "bundle.js"
  entitlements: {
    core_api_methods: ["me", "run_inline_query"]
    # URL del servicio en Cloud Run (la imprime service/deploy.sh)
    external_api_urls: ["https://ca-cap-XXXX-uc.a.run.app"]
    # User attribute con ámbito de extensión: ca_cap_ca_cap_admin_service_url
    scoped_user_attributes: ["service_url"]
  }
}
